import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ToolVersionId, WorkspaceId } from "@osva/contracts";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";

import { createWebProcess } from "../../../web/src/process.js";
import { bootstrapIntegrationAuth, fetchJson } from "./integration-auth.js";
import { createWorkerProcess } from "../../src/process.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";
import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "../../../../adapters/bullmq/test/integration/valkey-harness.js";

const WORKSPACE_ID = "ws-tool-e2e" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe("tool gateway end-to-end", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (postgres) {
      await stopPostgresForTests(postgres);
    }
    if (valkey) {
      await stopValkeyForTests(valkey);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, WORKSPACE_ID, NOW);
  });

  it("runs HTTP CreateRun through ToolGateway and persists tool output", async () => {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-tool-e2e-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "tool-echo-agent.ts"),
      path.join(trustedRuntimeRoot, "tool-echo-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "tool-echo-agent.ts")),
    );

    const web = createWebProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
    });
    const worker = createWorkerProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
    });

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;

      const tool = await fetchJson(`${origin}/v1/tools`, {
        method: "POST",
        body: {
          key: "echo",
          name: "Echo",
        },
      });
      const toolId = (tool.body as { id: string }).id;
      const version = await fetchJson(`${origin}/v1/tools/${toolId}/versions`, {
        method: "POST",
        body: { type: "INTERNAL", implementation: "OSVA_ECHO_V1" },
      });
      const toolVersionId = (version.body as { id: ToolVersionId }).id;

      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: {
          key: "tool-agent",
          name: "Tool Agent",
        },
      });
      const agentId = (agent.body as { id: string }).id;
      const agentVersion = await fetchJson(
        `${origin}/v1/agents/${agentId}/versions`,
        {
          method: "POST",
          body: {
            manifest: {
              schemaVersion: "1",
              key: "tool-agent",
              name: "Tool Agent",
              runtime: {
                type: "TRUSTED_TYPESCRIPT",
                entrypoint: "tool-echo-agent.ts",
                integrity,
              },
              input: { schema: {} },
              output: { schema: {} },
              execution: { timeoutMs: 5_000, maxAttempts: 1 },
              capabilities: { model: false, tools: ["echo"] },
              tools: {
                echo: { toolVersionId },
              },
            },
          },
        },
      );
      const agentVersionId = (agentVersion.body as { id: string }).id;

      const created = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: { hello: "tool-e2e" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      const attempt = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          echoed: { hello: "tool-e2e" },
          toolResult: { value: { hello: "tool-e2e" } },
          hasToolVersionId: false,
          hasImplementationId: false,
        },
      });

      const run = await fetchJson(`${origin}/v1/runs/${runId}`);
      expect(
        (run.body as { effectiveBindings?: { toolVersionBindings?: unknown } })
          .effectiveBindings?.toolVersionBindings,
      ).toEqual({ echo: toolVersionId });
    } finally {
      await worker.stop();
      await web.stop();
    }
  });
});

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for condition.");
}
