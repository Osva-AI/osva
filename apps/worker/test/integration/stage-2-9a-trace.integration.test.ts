import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RunAttemptId, WorkspaceId } from "@osva/contracts";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { createInMemoryOpenTelemetryHarness } from "@osva/adapters-opentelemetry/testing";
import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
import {
  createDatabase,
  migrateDatabase,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Workspace } from "@osva/domain";
import { extractBullMqTraceCarrier } from "@osva/observability";

import { createWebProcess } from "../../../../apps/web/src/process.js";
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

const WORKSPACE_ID = "ws-stage-29a" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe("Stage 2.9A trace continuity integration", () => {
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
    await new PostgresWorkspaceRepository(database).save(
      Workspace.create({
        id: WORKSPACE_ID,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
  });

  it("propagates trace context through create, queue, worker, runtime, and model gateway", async () => {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-stage-29a-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "model-text-agent.ts"),
      path.join(trustedRuntimeRoot, "model-text-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "model-text-agent.ts")),
    );
    const fakeOpenAI = await startFakeOpenAIResponsesServer();

    const telemetryHarness = await createInMemoryOpenTelemetryHarness();
    const instrumentation = telemetryHarness.instrumentation;
    const queue = new BullMqJobQueue({ url: valkey.url, instrumentation });

    const telemetry = {
      instrumentation,
      config: {
        enabled: true,
        serviceName: "osva-test",
        otlpEndpoint: undefined,
        otlpHeaders: {},
      },
      shutdown: async () => telemetryHarness.shutdown(),
    };

    const web = createWebProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      },
      (connectionString) =>
        createDatabase({ connectionString, max: 5, connectTimeoutSeconds: 10 }),
      () => queue,
      { telemetry },
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      },
      (connectionString) =>
        createDatabase({ connectionString, max: 5, connectTimeoutSeconds: 10 }),
      {
        telemetry,
        queueFactory: () => queue,
        openai: {
          apiKey: "test-key",
          baseURL: fakeOpenAI.origin,
          maxRetries: 0,
        },
      },
    );

    let workerStarted = false;

    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;

      const modelProfile = await fetchJson(`${origin}/v1/model-profiles`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
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
          workspaceId: WORKSPACE_ID,
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

      const run = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          agentId,
          agentVersionId,
          input: { message: "hello" },
        },
      });
      expect(run.status).toBe(201);
      const runBody = run.body as {
        run: { id: string; status: string };
        runAttempt: { id: string; status: string };
      };

      const queuedJob = await queue.getQueuedJob(
        runBody.runAttempt.id as RunAttemptId,
      );
      expect(queuedJob).not.toBeNull();
      expect(extractBullMqTraceCarrier(queuedJob!.data)?.traceparent).toMatch(
        /^00-/,
      );

      await worker.start();
      workerStarted = true;

      await waitFor(
        () => runBody.runAttempt.id,
        async () => {
          const response = await fetchJson(
            `${origin}/v1/runs/${runBody.run.id}`,
          );
          return (response.body as { status: string }).status;
        },
        (status) => status === "SUCCEEDED",
      );

      const completed = await fetchJson(
        `${origin}/v1/runs/${runBody.run.id}/attempts/${runBody.runAttempt.id}`,
      );
      expect(completed.body).toMatchObject({ status: "SUCCEEDED" });
    } finally {
      await telemetryHarness.shutdown();
      if (workerStarted) {
        await worker.stop();
      }
      await queue.shutdown();
      await web.stop();
      await fakeOpenAI.close();
    }
  }, 120_000);
});

async function fetchJson(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : null,
  };
}

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
