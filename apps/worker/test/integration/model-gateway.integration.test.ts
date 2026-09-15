import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import {
  createDatabase,
  migrateDatabase,
  PostgresRunRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Workspace } from "@osva/domain";

import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
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

const WORKSPACE_ID = "ws-model" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe("model gateway end-to-end", () => {
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

  it("freezes model bindings and executes generateText through the OpenAI adapter", async () => {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-model-"),
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
    const inspector = new BullMqJobQueue({ url: valkey.url });

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;

      const profile = await fetchJson(`${origin}/v1/model-profiles`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          key: "primary",
          name: "Primary",
        },
      });
      expect(profile.status).toBe(201);
      const modelProfileId = (profile.body as { id: string }).id;

      const version = await fetchJson(
        `${origin}/v1/model-profiles/${modelProfileId}/versions`,
        {
          method: "POST",
          body: { provider: "OPENAI", model: "gpt-test-snapshot" },
        },
      );
      expect(version.status).toBe(201);
      const modelProfileVersionId = (version.body as { id: string }).id;
      expect(version.body).not.toHaveProperty("apiKey");

      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          key: "model-text-agent",
          name: "Model Text Agent",
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
              key: "model-text-agent",
              name: "Model Text Agent",
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

      const created = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          agentId,
          agentVersionId: (agentVersion.body as { id: string }).id,
          input: { prompt: "e2e-model" },
        },
      });
      expect(created.status).toBe(201);
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;
      const frozenBindings = {
        agentVersionId: (agentVersion.body as { id: string }).id,
        modelProfileVersionBindings: { primary: modelProfileVersionId },
      };
      expect(
        (created.body as { run: { effectiveBindings: unknown } }).run
          .effectiveBindings,
      ).toEqual(frozenBindings);

      const runAfterCreate = await fetchJson(`${origin}/v1/runs/${runId}`);
      expect(
        (runAfterCreate.body as { effectiveBindings: unknown })
          .effectiveBindings,
      ).toEqual(frozenBindings);

      await fetchJson(
        `${origin}/v1/model-profiles/${modelProfileId}/versions`,
        {
          method: "POST",
          body: { provider: "OPENAI", model: "gpt-newer-snapshot" },
        },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });

      const attempt = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: { text: "normalized text from fake openai" },
      });
      expect(fakeOpenAI.requests).toHaveLength(1);
      expect(fakeOpenAI.requests[0]?.body).toMatchObject({
        model: "gpt-test-snapshot",
        store: false,
      });

      const frozen = await fetchJson(`${origin}/v1/runs/${runId}`);
      expect(
        (
          frozen.body as {
            effectiveBindings: {
              modelProfileVersionBindings: { primary: string };
            };
          }
        ).effectiveBindings.modelProfileVersionBindings.primary,
      ).toBe(modelProfileVersionId);

      const producer = new BullMqJobQueue({ url: valkey.url });
      try {
        await producer.enqueue(runAttemptId);
        await delay(500);
        expect(fakeOpenAI.requests).toHaveLength(1);
        expect(await inspector.countActiveJobs()).toBe(0);
      } finally {
        await producer.shutdown();
      }
    } finally {
      await worker.stop();
      await inspector.shutdown();
      await web.stop();
      await fakeOpenAI.close();
    }
  });

  it("fails OPENAI bindings with MODEL_PROVIDER_UNAVAILABLE when no key is configured", async () => {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-model-unavailable-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "model-text-agent.ts"),
      path.join(trustedRuntimeRoot, "model-text-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "model-text-agent.ts")),
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
    const runs = new PostgresRunRepository(database);

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;

      const profile = await fetchJson(`${origin}/v1/model-profiles`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          key: "primary",
          name: "Primary",
        },
      });
      const modelProfileId = (profile.body as { id: string }).id;
      const version = await fetchJson(
        `${origin}/v1/model-profiles/${modelProfileId}/versions`,
        {
          method: "POST",
          body: { provider: "OPENAI", model: "gpt-test-snapshot" },
        },
      );
      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          key: "model-unavailable",
          name: "Model Unavailable",
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
              key: "model-unavailable",
              name: "Model Unavailable",
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
                primary: {
                  modelProfileVersionId: (version.body as { id: string }).id,
                },
              },
            },
          },
        },
      );
      const created = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          agentId,
          agentVersionId: (agentVersion.body as { id: string }).id,
          input: {},
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await runs.findRunById(runId);
        return run?.status === "FAILED";
      });
      const attempt = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "FAILED",
        error: { code: "MODEL_PROVIDER_UNAVAILABLE" },
      });
    } finally {
      await worker.stop();
      await web.stop();
    }
  });
});

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for model gateway execution.");
}

async function fetchJson(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: response.status, body: await response.json() };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
