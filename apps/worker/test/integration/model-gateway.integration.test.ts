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
  type Database,
} from "@osva/db";

import { startFakeAnthropicMessagesServer } from "../../../../adapters/model-anthropic/test/fake-anthropic-server.js";
import { bootstrapIntegrationAuth, fetchJson } from "./integration-auth.js";
import { startFakeGeminiGenerateContentServer } from "../../../../adapters/model-gemini/test/fake-gemini-server.js";
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
    await bootstrapIntegrationAuth(database, WORKSPACE_ID, NOW);
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
      expect(version.status).toBe(201);
      const modelProfileVersionId = (version.body as { id: string }).id;
      expect(version.body).not.toHaveProperty("apiKey");

      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: {
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
        toolVersionBindings: {},
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

      const steps = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      expect(steps.status).toBe(200);
      const stepList = (steps.body as { steps: Array<Record<string, unknown>> })
        .steps;
      expect(stepList).toHaveLength(1);
      expect(stepList[0]).toMatchObject({
        kind: "MODEL",
        bindingName: "primary",
        status: "SUCCEEDED",
        modelProfileVersionId,
        inputTokens: 120,
        outputTokens: 15,
        totalTokens: 135,
        cachedInputTokens: 8,
        estimatedCostUsdMicros: 150,
      });
      expect(stepList[0]).not.toHaveProperty("messages");
      expect(stepList[0]).not.toHaveProperty("text");

      const usage = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}/usage`,
      );
      expect(usage.status).toBe(200);
      expect(usage.body).toEqual({
        modelCalls: 1,
        toolCalls: 0,
        inputTokens: 120,
        outputTokens: 15,
        totalTokens: 135,
        cachedInputTokens: 8,
        estimatedCostUsdMicros: 150,
        pricedModelCalls: 1,
        unpricedModelCalls: 0,
      });

      const evaluation = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}/evaluations`,
        {
          method: "POST",
          body: {
            evaluator: {
              type: "JSON_EXACT_MATCH",
              expected: { text: "normalized text from fake openai" },
            },
          },
        },
      );
      expect(evaluation.status).toBe(201);
      expect(evaluation.body).toMatchObject({
        evaluatorType: "JSON_EXACT_MATCH",
        passed: true,
        score: 1,
      });

      const producer = new BullMqJobQueue({ url: valkey.url });
      try {
        await producer.enqueue(runAttemptId);
        await delay(500);
        expect(fakeOpenAI.requests).toHaveLength(1);
        expect(await inspector.countActiveJobs()).toBe(0);
        const stepsAfterRedelivery = await fetchJson(
          `${origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
        );
        expect(
          (stepsAfterRedelivery.body as { steps: unknown[] }).steps,
        ).toHaveLength(1);
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

  it("freezes Anthropic bindings and executes generateText through the Anthropic adapter", async () => {
    await runProviderEndToEnd(postgres, valkey, {
      provider: "ANTHROPIC",
      model: "claude-test-snapshot",
      expectedText: "normalized text from fake anthropic",
      expectedUsage: {
        inputTokens: 120,
        outputTokens: 15,
        totalTokens: 135,
        estimatedCostUsdMicros: 150,
      },
      startFakeProvider: startFakeAnthropicMessagesServer,
      workerDependencyKey: "anthropic",
      assertProviderRequest: (requests) => {
        expect(requests[0]?.body).toMatchObject({
          model: "claude-test-snapshot",
          system: "You are concise.",
        });
      },
    });
  });

  it("freezes Gemini bindings and executes generateText through the Gemini adapter", async () => {
    await runProviderEndToEnd(postgres, valkey, {
      provider: "GOOGLE_GEMINI",
      model: "gemini-test-snapshot",
      expectedText: "normalized text from fake gemini",
      expectedUsage: {
        inputTokens: 120,
        outputTokens: 15,
        totalTokens: 135,
        estimatedCostUsdMicros: 150,
      },
      startFakeProvider: startFakeGeminiGenerateContentServer,
      workerDependencyKey: "gemini",
      assertProviderRequest: (requests) => {
        expect(requests[0]?.url).toContain(
          "/models/gemini-test-snapshot:generateContent",
        );
        expect(requests[0]?.body).toMatchObject({
          systemInstruction: { parts: [{ text: "You are concise." }] },
        });
      },
    });
  });

  it("records unpriced usage when a Gemini model profile version has no pricing snapshot", async () => {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-gemini-unpriced-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "model-text-agent.ts"),
      path.join(trustedRuntimeRoot, "model-text-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "model-text-agent.ts")),
    );
    const fakeGemini = await startFakeGeminiGenerateContentServer();

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
        gemini: {
          apiKey: "test-key",
          baseURL: fakeGemini.origin,
        },
      },
    );

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const profile = await fetchJson(`${origin}/v1/model-profiles`, {
        method: "POST",
        body: {
          key: "primary",
          name: "Primary",
        },
      });
      const modelProfileId = (profile.body as { id: string }).id;
      const version = await fetchJson(
        `${origin}/v1/model-profiles/${modelProfileId}/versions`,
        {
          method: "POST",
          body: { provider: "GOOGLE_GEMINI", model: "gemini-test-snapshot" },
        },
      );
      const modelProfileVersionId = (version.body as { id: string }).id;
      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: {
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
      const created = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId: (agentVersion.body as { id: string }).id,
          input: { prompt: "e2e-gemini-unpriced" },
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

      const steps = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      expect(
        (steps.body as { steps: Array<Record<string, unknown>> }).steps[0],
      ).toMatchObject({
        inputTokens: 120,
        outputTokens: 15,
        totalTokens: 135,
        estimatedCostUsdMicros: null,
      });

      const usage = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}/usage`,
      );
      expect(usage.body).toMatchObject({
        pricedModelCalls: 0,
        unpricedModelCalls: 1,
        estimatedCostUsdMicros: null,
      });
    } finally {
      await worker.stop();
      await web.stop();
      await fakeGemini.close();
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

async function runProviderEndToEnd(
  postgres: PostgresTestContext,
  valkey: ValkeyTestContext,
  options: {
    readonly provider: "ANTHROPIC" | "GOOGLE_GEMINI" | "OPENAI";
    readonly model: string;
    readonly expectedText: string;
    readonly expectedUsage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly estimatedCostUsdMicros: number;
    };
    readonly startFakeProvider: () => Promise<{
      readonly origin: string;
      readonly requests: Array<{
        readonly body: unknown;
        readonly url?: string;
      }>;
      close(): Promise<void>;
    }>;
    readonly workerDependencyKey: "anthropic" | "gemini" | "openai";
    readonly assertProviderRequest: (
      requests: Array<{ readonly body: unknown; readonly url?: string }>,
    ) => void;
  },
): Promise<void> {
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `osva-e2e-model-${options.provider.toLowerCase()}-`),
  );
  await fs.copyFile(
    path.join(FIXTURE_DIR, "model-text-agent.ts"),
    path.join(trustedRuntimeRoot, "model-text-agent.ts"),
  );
  const integrity = sha256IntegrityOf(
    await fs.readFile(path.join(trustedRuntimeRoot, "model-text-agent.ts")),
  );
  const fakeProvider = await options.startFakeProvider();

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
      [options.workerDependencyKey]: {
        apiKey: "test-key",
        baseURL: fakeProvider.origin,
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
      body: {
        key: "primary",
        name: "Primary",
      },
    });
    const modelProfileId = (profile.body as { id: string }).id;
    const version = await fetchJson(
      `${origin}/v1/model-profiles/${modelProfileId}/versions`,
      {
        method: "POST",
        body: {
          provider: options.provider,
          model: options.model,
          pricing: {
            currency: "USD",
            inputUsdMicrosPerMillionTokens: 1_000_000,
            outputUsdMicrosPerMillionTokens: 2_000_000,
          },
        },
      },
    );
    const modelProfileVersionId = (version.body as { id: string }).id;
    const agent = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
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
    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        agentId,
        agentVersionId: (agentVersion.body as { id: string }).id,
        input: { prompt: `e2e-${options.provider.toLowerCase()}` },
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
      output: { text: options.expectedText },
    });
    expect(fakeProvider.requests).toHaveLength(1);
    options.assertProviderRequest(fakeProvider.requests);

    const steps = await fetchJson(
      `${origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
    );
    expect(
      (steps.body as { steps: Array<Record<string, unknown>> }).steps[0],
    ).toMatchObject({
      kind: "MODEL",
      bindingName: "primary",
      status: "SUCCEEDED",
      modelProfileVersionId,
      ...options.expectedUsage,
    });
    expect(
      (steps.body as { steps: Array<Record<string, unknown>> }).steps[0],
    ).not.toHaveProperty("apiKey");
  } finally {
    await worker.stop();
    await web.stop();
    await fakeProvider.close();
  }
}

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
