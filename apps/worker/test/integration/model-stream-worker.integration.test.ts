import fs from "node:fs/promises";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva-ai/contracts";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";

import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
import { bootstrapIntegrationAuth, fetchJson } from "./integration-auth.js";
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

const WORKSPACE_ID = "ws-stream" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe("model stream worker integration", () => {
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

  async function registerStreamingAgent(options: {
    readonly fixtureName: string;
    readonly agentKey: string;
    readonly fakeOpenAI: Awaited<
      ReturnType<typeof startFakeOpenAIResponsesServer>
    >;
  }) {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-stream-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, options.fixtureName),
      path.join(trustedRuntimeRoot, options.fixtureName),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, options.fixtureName)),
    );

    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
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
          baseURL: options.fakeOpenAI.origin,
          maxRetries: 0,
        },
      },
    );
    const inspector = new BullMqJobQueue({ url: valkey.url });

    const port = await web.listen();
    await worker.start();
    const origin = `http://127.0.0.1:${String(port)}`;

    const profile = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: { key: "primary", name: "Primary" },
    });
    const modelProfileId = (profile.body as { id: string }).id;
    const version = await fetchJson(
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
            cachedReadInputUsdMicrosPerMillionTokens: 1_000_000,
          },
        },
      },
    );
    const modelProfileVersionId = (version.body as { id: string }).id;

    const agent = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: { key: options.agentKey, name: options.agentKey },
    });
    const agentId = (agent.body as { id: string }).id;
    const agentVersion = await fetchJson(
      `${origin}/v1/agents/${agentId}/versions`,
      {
        method: "POST",
        body: {
          manifest: {
            schemaVersion: "1",
            key: options.agentKey,
            name: options.agentKey,
            runtime: {
              type: "TRUSTED_TYPESCRIPT",
              entrypoint: options.fixtureName,
              integrity,
            },
            input: { schema: {} },
            output: { schema: {} },
            execution: { timeoutMs: 12_000, maxAttempts: 1 },
            capabilities: { model: true, tools: [] },
            models: {
              primary: { modelProfileVersionId },
            },
          },
        },
      },
    );

    return {
      cleanup: async () => {
        await worker.stop();
        await web.stop();
        await inspector.shutdown();
      },
      origin,
      agentId,
      agentVersionId: (agentVersion.body as { id: string }).id,
      modelProfileVersionId,
    };
  }

  it("scenario A: streams text deltas and records one succeeded MODEL step", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const harness = await registerStreamingAgent({
      fixtureName: "model-stream-text-agent.ts",
      agentKey: "model-stream-text-agent",
      fakeOpenAI,
    });

    try {
      const created = await fetchJson(`${harness.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: harness.agentId,
          agentVersionId: harness.agentVersionId,
          input: { prompt: "stream-a" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${harness.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });

      const attempt = await fetchJson(
        `${harness.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          text: "normalized text from fake openai",
          deltas: expect.arrayContaining([expect.any(String)]),
        },
      });
      expect(
        (attempt.body as { output: { deltas: string[] } }).output.deltas.length,
      ).toBeGreaterThanOrEqual(1);
      expect(fakeOpenAI.requests).toHaveLength(1);

      const steps = await fetchJson(
        `${harness.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      const stepList = (steps.body as { steps: Array<Record<string, unknown>> })
        .steps;
      expect(stepList).toHaveLength(1);
      expect(stepList[0]).toMatchObject({
        kind: "MODEL",
        bindingName: "primary",
        status: "SUCCEEDED",
        modelProfileVersionId: harness.modelProfileVersionId,
        inputTokens: 120,
        outputTokens: 15,
        providerRequestId: expect.any(String),
        usageIncomplete: false,
      });
    } finally {
      await harness.cleanup();
      await fakeOpenAI.close();
    }
  });

  it("scenario B: streams tool argument deltas over IPC", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const harness = await registerStreamingAgent({
      fixtureName: "model-stream-tool-agent.ts",
      agentKey: "model-stream-tool-agent",
      fakeOpenAI,
    });

    try {
      const created = await fetchJson(`${harness.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: harness.agentId,
          agentVersionId: harness.agentVersionId,
          input: { prompt: "stream-b" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${harness.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });

      const attempt = await fetchJson(
        `${harness.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          toolCallIds: ["call_declarative_1"],
          toolNames: ["echo"],
          argumentDeltas: expect.arrayContaining([
            '{"value":"',
            "declarative-tool-input",
            '"}',
          ]),
        },
      });

      const steps = await fetchJson(
        `${harness.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      const stepList = (steps.body as { steps: Array<Record<string, unknown>> })
        .steps;
      expect(stepList).toHaveLength(1);
      expect(stepList[0]).toMatchObject({
        kind: "MODEL",
        bindingName: "primary",
        status: "SUCCEEDED",
        inputTokens: 120,
        outputTokens: 15,
        usageIncomplete: false,
      });
    } finally {
      await harness.cleanup();
      await fakeOpenAI.close();
    }
  });

  it("scenario C: mid-stream provider failure does not succeed the run", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const harness = await registerStreamingAgent({
      fixtureName: "model-stream-fail-agent.ts",
      agentKey: "model-stream-fail-agent",
      fakeOpenAI,
    });

    try {
      const created = await fetchJson(`${harness.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: harness.agentId,
          agentVersionId: harness.agentVersionId,
          input: { prompt: "stream-c" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${harness.origin}/v1/runs/${runId}`);
        const status = (run.body as { status?: string }).status;
        return run.status === 200 && status === "FAILED";
      });

      const attempt = await fetchJson(
        `${harness.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({ status: "FAILED" });
      const output = (attempt.body as { output?: { partialText?: string } })
        .output;
      expect(output?.partialText).not.toBe("normalized text from fake openai");

      const steps = await fetchJson(
        `${harness.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      const stepList = (steps.body as { steps: Array<Record<string, unknown>> })
        .steps;
      expect(stepList).toHaveLength(1);
      expect(stepList[0]).toMatchObject({
        kind: "MODEL",
        status: "FAILED",
      });
      expect(stepList[0]?.inputTokens).toBeUndefined();
    } finally {
      await harness.cleanup();
      await fakeOpenAI.close();
    }
  });

  // Early close: the agent stops consuming (break), child sends stream.close, parent
  // aborts the provider. Unlike scenario C (provider failure), no synthetic COMPLETED;
  // MODEL RunStep finalizes FAILED without token usage. RunAttempt may still SUCCEEDED
  // when the agent returns valid partial output.
  it("scenario D: child early stream close aborts the provider stream", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const harness = await registerStreamingAgent({
      fixtureName: "model-stream-cancel-agent.ts",
      agentKey: "model-stream-cancel-agent",
      fakeOpenAI,
    });

    try {
      const created = await fetchJson(`${harness.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: harness.agentId,
          agentVersionId: harness.agentVersionId,
          input: { prompt: "stream-d" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      const settled = waitUntil(async () => {
        const run = await fetchJson(`${harness.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });
      await Promise.race([settled, fakeOpenAI.waitForAbort()]);

      const attempt = await fetchJson(
        `${harness.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: { deltas: ["partial-"], stoppedEarly: true },
      });

      const steps = await fetchJson(
        `${harness.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      const stepList = (steps.body as { steps: Array<Record<string, unknown>> })
        .steps;
      expect(stepList).toHaveLength(1);
      expect(stepList[0]).toMatchObject({
        kind: "MODEL",
        status: "FAILED",
      });
      expect(stepList[0]?.inputTokens).toBeUndefined();
      expect(stepList[0]?.outputTokens).toBeUndefined();
      expect(stepList[0]?.providerRequestId).toBeUndefined();
      expect(stepList[0]?.usageIncomplete).not.toBe(true);
    } finally {
      await harness.cleanup();
      await fakeOpenAI.close();
    }
  });

  it("scenario E: synchronous generateText agents still work alongside streaming IPC", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-sync-regression-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "model-text-agent.ts"),
      path.join(trustedRuntimeRoot, "model-text-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "model-text-agent.ts")),
    );

    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
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

      const profile = await fetchJson(`${origin}/v1/model-profiles`, {
        method: "POST",
        body: { key: "primary", name: "Primary" },
      });
      const modelProfileId = (profile.body as { id: string }).id;
      const version = await fetchJson(
        `${origin}/v1/model-profiles/${modelProfileId}/versions`,
        {
          method: "POST",
          body: { provider: "OPENAI", model: "gpt-test-snapshot" },
        },
      );
      const modelProfileVersionId = (version.body as { id: string }).id;

      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: { key: "model-text-agent", name: "Model Text Agent" },
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
              models: { primary: { modelProfileVersionId } },
            },
          },
        },
      );

      const created = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId: (agentVersion.body as { id: string }).id,
          input: { prompt: "sync-e" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

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
    } finally {
      await worker.stop();
      await web.stop();
      await fakeOpenAI.close();
    }
  });
});

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for model stream execution.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
