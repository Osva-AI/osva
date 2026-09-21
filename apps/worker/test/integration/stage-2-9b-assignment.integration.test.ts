import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";

import { createWebProcess } from "../../../../apps/web/src/process.js";
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

const WORKSPACE_ID = "ws-stage-29b" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe("Stage 2.9B assignment execution integration", () => {
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

  it("launches an agent-backed assignment through normal run execution", async () => {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-stage-29b-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "model-text-agent.ts"),
      path.join(trustedRuntimeRoot, "model-text-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "model-text-agent.ts")),
    );
    const fakeOpenAI = await startFakeOpenAIResponsesServer();

    const web = createWebProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
    });
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: fakeOpenAI.origin,
          maxRetries: 0,
        },
      },
    );

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;

      const modelProfile = await fetchJson(`${origin}/v1/model-profiles`, {
        method: "POST",
        body: {
          key: "openai-default",
          name: "OpenAI Default",
        },
      });
      expect(modelProfile.status).toBe(201);
      const modelProfileId = (modelProfile.body as { id: string }).id;

      const modelProfileVersion = await fetchJson(
        `${origin}/v1/model-profiles/${modelProfileId}/versions`,
        {
          method: "POST",
          body: {
            provider: "OPENAI",
            model: "gpt-test-snapshot",
            pricing: {
              currency: "USD",
              inputUsdMicrosPerMillionTokens: 1_000_000,
              outputUsdMicrosPerMillionTokens: 2_000_000,
            },
          },
        },
      );
      expect(modelProfileVersion.status).toBe(201);
      const modelProfileVersionId = (modelProfileVersion.body as { id: string })
        .id;

      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: {
          key: "model-echo-agent",
          name: "Model Echo Agent",
        },
      });
      expect(agent.status).toBe(201);
      const agentId = (agent.body as { id: string }).id;

      const agentVersion = await fetchJson(
        `${origin}/v1/agents/${agentId}/versions`,
        {
          method: "POST",
          body: {
            manifest: {
              schemaVersion: "1",
              key: "model-echo-agent",
              name: "Model Echo Agent",
              runtime: {
                type: "TRUSTED_TYPESCRIPT",
                entrypoint: "model-text-agent.ts",
                integrity,
              },
              input: { schema: {} },
              output: { schema: {} },
              execution: { timeoutMs: 8_000, maxAttempts: 1 },
              capabilities: { model: true, tools: [] },
              models: {
                primary: { modelProfileVersionId },
              },
            },
          },
        },
      );
      expect(agentVersion.status).toBe(201);
      const agentVersionId = (agentVersion.body as { id: string }).id;

      const officeWorker = await fetchJson(`${origin}/v1/office/workers`, {
        method: "POST",
        body: {
          key: "analyst",
          name: "Analyst",
          agentId,
        },
      });
      expect(officeWorker.status).toBe(201);
      const officeWorkerId = (officeWorker.body as { id: string }).id;

      const assignment = await fetchJson(`${origin}/v1/office/assignments`, {
        method: "POST",
        body: {
          officeWorkerId,
          title: "Analyze message",
          targetType: "AGENT_VERSION",
          targetVersionId: agentVersionId,
          input: { message: "hello" },
        },
      });
      expect(assignment.status).toBe(201);
      const assignmentId = (assignment.body as { id: string }).id;
      expect(
        (assignment.body as { targetVersionId: string }).targetVersionId,
      ).toBe(agentVersionId);

      const launched = await fetchJson(
        `${origin}/v1/office/assignments/${assignmentId}/launch`,
        { method: "POST" },
      );
      expect(launched.status).toBe(200);
      const launchedBody = launched.body as {
        runId?: string;
        status: string;
      };
      expect(launchedBody.runId).toBeDefined();

      const relaunched = await fetchJson(
        `${origin}/v1/office/assignments/${assignmentId}/launch`,
        { method: "POST" },
      );
      expect(relaunched.status).toBe(200);
      expect((relaunched.body as { runId?: string }).runId).toBe(
        launchedBody.runId,
      );

      await waitFor(
        launchedBody.runId!,
        async () => {
          const response = await fetchJson(
            `${origin}/v1/office/assignments/${assignmentId}`,
          );
          return (response.body as { status: string }).status;
        },
        (status) => status === "COMPLETED",
      );

      const runResponse = await fetchJson(
        `${origin}/v1/runs/${launchedBody.runId}`,
      );
      expect((runResponse.body as { status: string }).status).toBe("SUCCEEDED");
    } finally {
      await worker.stop();
      await web.stop();
      await fakeOpenAI.close();
    }
  }, 120_000);
});

async function waitFor<T>(
  _label: string,
  poll: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 30_000,
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await poll();
    if (done(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for condition.");
}
