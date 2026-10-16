import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RunId, WorkspaceId } from "@osva-ai/contracts";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import {
  createDatabase,
  migrateDatabase,
  PostgresRunRepository,
  type Database,
} from "@osva/db";

import { createWebProcess } from "../../../../apps/web/src/process.js";
import {
  bootstrapIntegrationAuth,
  fetchJson,
} from "../../../../apps/worker/test/integration/integration-auth.js";
import { createWorkerProcess } from "../../../../apps/worker/src/process.js";
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

import {
  agentArtifactPath,
  HELLO_AGENT_ENTRYPOINT,
  HELLO_AGENT_KEY,
  HELLO_DEFAULT_INPUT,
  HELLO_EXPECTED_OUTPUT,
} from "../../scripts/lib/constants.js";
import { buildHelloAgentManifest } from "../../scripts/lib/manifest.js";

const WORKSPACE_ID = "ws-hello-agent" as WorkspaceId;
const NOW = new Date("2026-10-14T12:00:00.000Z");
describe("Hello Agent end-to-end", () => {
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
    await database.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, WORKSPACE_ID, NOW);
  });

  it("registers, executes, and returns deterministic output through PostgreSQL and Valkey", async () => {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-hello-agent-"),
    );
    const entrypointPath = path.join(
      trustedRuntimeRoot,
      HELLO_AGENT_ENTRYPOINT,
    );
    await fs.copyFile(agentArtifactPath, entrypointPath);
    const integrity = sha256IntegrityOf(await fs.readFile(entrypointPath));
    const manifest = await buildHelloAgentManifest({ integrity });

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
    const runs = new PostgresRunRepository(database);

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;

      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: { key: HELLO_AGENT_KEY, name: "Hello Agent" },
      });
      expect(agent.status).toBe(201);
      const agentId = (agent.body as { id: string }).id;

      const version = await fetchJson(
        `${origin}/v1/agents/${agentId}/versions`,
        {
          method: "POST",
          body: { manifest },
        },
      );
      expect(version.status).toBe(201);
      const agentVersionId = (version.body as { id: string }).id;

      const created = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: HELLO_DEFAULT_INPUT,
        },
      });
      expect(created.status).toBe(201);
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await runs.findRunById(runId as RunId);
        return run?.status === "SUCCEEDED";
      });

      const attempt = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: HELLO_EXPECTED_OUTPUT,
      });
    } finally {
      await worker.stop();
      await web.stop();
      await fs.rm(trustedRuntimeRoot, { recursive: true, force: true });
    }
  });
});

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for Hello Agent Run to succeed.");
}
