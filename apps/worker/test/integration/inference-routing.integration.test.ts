import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ValkeyExactResponseCache,
  createAesGcmWireProtection,
  isEncryptedCacheWire,
  parseKeyRingFromEnv,
} from "@osva/adapters-inference-cache-valkey";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import {
  startFakeOpenAIResponsesServer,
  type FakeOpenAIResponsesServer,
} from "../../../../adapters/model-openai/test/fake-openai-server.js";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import type {
  InferenceResponseCachePolicyV1,
  WorkspaceId,
} from "@osva-ai/contracts";
import { INFERENCE_CACHE_STORAGE_KEY_PREFIX } from "@osva-ai/contracts";
import {
  createDatabase,
  migrateDatabase,
  PostgresModelProfileRepository,
  PostgresRunRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Redis } from "ioredis";
import { ModelProfile, ModelProfileVersion, Workspace } from "@osva/domain";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { createWebProcess } from "../../../../apps/web/src/process.js";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";
import { createWorkerProcess } from "../../src/process.js";
import { bootstrapIntegrationAuth, fetchJson } from "./integration-auth.js";
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

const WORKSPACE = "ws-routing-a" as WorkspaceId;
const WORKSPACE_B = "ws-routing-b" as WorkspaceId;
const NOW = new Date("2026-02-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

const TRUSTED_CACHE_POLICY: InferenceResponseCachePolicyV1 = {
  schemaVersion: "1",
  enabled: true,
  determinism: "REQUIRED_DETERMINISTIC",
  ttlSeconds: 3_600,
};

const INTEGRATION_CACHE_KEY_RING = parseKeyRingFromEnv({
  activeKeyId: "integration",
  activeKeyB64: Buffer.alloc(32, 21).toString("base64"),
});

describe("inference routing worker acceptance", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;
  let redis: Redis;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
    });
    await migrateDatabase(database);
    redis = new Redis(valkey.url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
    });
  });

  afterAll(async () => {
    await redis.quit();
    await database.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, WORKSPACE, NOW);
    await redis.flushdb();
  });

  afterEach(async () => {
    await redis.flushdb();
  });

  async function countCacheKeys(): Promise<number> {
    const keys = await redis.keys(`${INFERENCE_CACHE_STORAGE_KEY_PREFIX}*`);
    return keys.length;
  }

  async function decisionCount(): Promise<number> {
    const rows = await database.sql`
      SELECT COUNT(*)::int AS count FROM inference_routing_decisions
    `;
    return rows[0]?.count ?? 0;
  }

  function providerModelCounts(
    fake: FakeOpenAIResponsesServer,
  ): Map<string, number> {
    const counts = new Map<string, number>();
    for (const request of fake.requests) {
      const body = request.body;
      if (body === null || typeof body !== "object" || !("model" in body)) {
        continue;
      }
      const model = (body as { model?: string }).model;
      if (typeof model !== "string") {
        continue;
      }
      counts.set(model, (counts.get(model) ?? 0) + 1);
    }
    return counts;
  }

  async function activatePolicy(
    origin: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const policy = await fetchJson(`${origin}/v1/inference-routing-policies`, {
      method: "POST",
      body,
    });
    expect(policy.status).toBe(201);
    const policyVersionId = (policy.body as { version: { id: string } }).version
      .id;
    const activated = await fetchJson(
      `${origin}/v1/inference-routing-policies/activate`,
      {
        method: "POST",
        body: { policyVersionId, enabled: true },
      },
    );
    expect(activated.status).toBe(200);
    return policyVersionId;
  }

  async function seedRunStack(
    fakeOrigin: string,
    options?: { readonly withCache?: boolean },
  ) {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-routing-runtime-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "model-text-agent.ts"),
      path.join(trustedRuntimeRoot, "model-text-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "model-text-agent.ts")),
    );
    const env = {
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
      OPENAI_API_KEY: "test-key",
    };

    const web = createWebProcess(withTestAuthEnv(env));
    const cache =
      options?.withCache === true
        ? new ValkeyExactResponseCache({
            url: valkey.url,
            wireProtection: createAesGcmWireProtection({
              keyRing: INTEGRATION_CACHE_KEY_RING,
              rejectLegacyPlaintext: true,
            }),
          })
        : undefined;
    const worker = createWorkerProcess(
      { ...env, OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: `${fakeOrigin}/v1`,
          maxRetries: 0,
        },
        ...(options?.withCache === true
          ? {
              exactResponseCache: cache,
              trustedInferenceResponseCachePolicy: TRUSTED_CACHE_POLICY,
            }
          : {}),
      },
    );
    const inspector = new BullMqJobQueue({ url: valkey.url });
    const port = await web.listen();
    await worker.start();
    const origin = `http://127.0.0.1:${String(port)}`;

    const connection = await fetchJson(
      `${origin}/v1/model-provider-connections`,
      {
        method: "POST",
        body: {
          key: "conn-routing",
          name: "Routing connection",
          provider: "OPENAI",
        },
      },
    );
    const connectionId = (connection.body as { id: string }).id;
    const connectionVersion = await fetchJson(
      `${origin}/v1/model-provider-connections/${connectionId}/versions`,
      {
        method: "POST",
        body: {
          endpoint: {
            baseUrl: `${fakeOrigin}/v1`,
            allowPrivateNetworks: true,
          },
          credentialRef: { key: "OPENAI_API_KEY" },
        },
      },
    );
    const connectionVersionId = (connectionVersion.body as { id: string }).id;

    const profile = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: { key: "routing-primary", name: "Routing Primary" },
    });
    const modelProfileId = (profile.body as { id: string }).id;
    const version = await fetchJson(
      `${origin}/v1/model-profiles/${modelProfileId}/versions`,
      {
        method: "POST",
        body: {
          provider: "OPENAI",
          model: "gpt-routing-test",
          modelProviderConnectionVersionId: connectionVersionId,
          pricing: {
            currency: "USD",
            inputUsdMicrosPerMillionTokens: 1_000_000,
            outputUsdMicrosPerMillionTokens: 2_000_000,
          },
        },
      },
    );
    const modelProfileVersionId = (version.body as { id: string }).id;

    const cheapProfile = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: { key: "routing-cheap", name: "Routing Cheap" },
    });
    const cheapProfileId = (cheapProfile.body as { id: string }).id;
    const cheapVersion = await fetchJson(
      `${origin}/v1/model-profiles/${cheapProfileId}/versions`,
      {
        method: "POST",
        body: {
          provider: "OPENAI",
          model: "gpt-routing-cheap",
          modelProviderConnectionVersionId: connectionVersionId,
          pricing: {
            currency: "USD",
            inputUsdMicrosPerMillionTokens: 100_000,
            outputUsdMicrosPerMillionTokens: 100_000,
          },
        },
      },
    );
    const cheapModelProfileVersionId = (cheapVersion.body as { id: string }).id;

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
    const agentVersionId = (agentVersion.body as { id: string }).id;

    async function createModelVersion(input: {
      readonly key: string;
      readonly model: string;
      readonly inputUsdMicrosPerMillionTokens?: number;
      readonly modelProviderConnectionVersionId?: string;
    }) {
      const profile = await fetchJson(`${origin}/v1/model-profiles`, {
        method: "POST",
        body: { key: input.key, name: input.key },
      });
      const modelProfileId = (profile.body as { id: string }).id;
      const version = await fetchJson(
        `${origin}/v1/model-profiles/${modelProfileId}/versions`,
        {
          method: "POST",
          body: {
            provider: "OPENAI",
            model: input.model,
            modelProviderConnectionVersionId:
              input.modelProviderConnectionVersionId ?? connectionVersionId,
            pricing: {
              currency: "USD",
              inputUsdMicrosPerMillionTokens:
                input.inputUsdMicrosPerMillionTokens ?? 1_000_000,
              outputUsdMicrosPerMillionTokens:
                input.inputUsdMicrosPerMillionTokens ?? 2_000_000,
            },
          },
        },
      );
      return (version.body as { id: string }).id;
    }

    return {
      origin,
      worker,
      web,
      inspector,
      agentId,
      agentVersionId,
      modelProfileVersionId,
      cheapModelProfileVersionId,
      connectionVersionId,
      createModelVersion,
      async shutdown() {
        await worker.stop();
        await inspector.shutdown();
        await web.stop();
      },
    };
  }

  async function waitForRunStatus(
    origin: string,
    runId: string,
  ): Promise<string> {
    for (let i = 0; i < 120; i += 1) {
      const run = await fetchJson(`${origin}/v1/runs/${runId}`);
      if (run.status === 200) {
        const status = (run.body as { status?: string }).status;
        if (status === "SUCCEEDED" || status === "FAILED") {
          return status ?? "UNKNOWN";
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return "TIMEOUT";
  }

  async function executeRun(
    origin: string,
    agentId: string,
    agentVersionId: string,
  ) {
    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        agentId,
        agentVersionId,
        input: { prompt: "routing-acceptance" },
      },
    });
    expect(created.status).toBe(201);
    const runId = (created.body as { run: { id: string } }).run.id;
    for (let i = 0; i < 120; i += 1) {
      const run = await fetchJson(`${origin}/v1/runs/${runId}`);
      if (
        run.status === 200 &&
        (run.body as { status?: string }).status === "SUCCEEDED"
      ) {
        return runId;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("run did not succeed in time");
  }

  async function executeRunWithAttempt(
    origin: string,
    agentId: string,
    agentVersionId: string,
  ): Promise<{ runId: string; runAttemptId: string }> {
    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        agentId,
        agentVersionId,
        input: { prompt: "routing-acceptance" },
      },
    });
    expect(created.status).toBe(201);
    const runId = (created.body as { run: { id: string } }).run.id;
    const runAttemptId = (created.body as { runAttempt: { id: string } })
      .runAttempt.id;
    expect(await waitForRunStatus(origin, runId)).toBe("SUCCEEDED");
    return { runId, runAttemptId };
  }

  async function seedStreamStack(fakeOrigin: string) {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-routing-stream-"),
    );
    const fixtureName = "model-stream-text-agent.ts";
    await fs.copyFile(
      path.join(FIXTURE_DIR, fixtureName),
      path.join(trustedRuntimeRoot, fixtureName),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, fixtureName)),
    );
    const env = {
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
      OPENAI_API_KEY: "test-key",
    };

    const web = createWebProcess(withTestAuthEnv(env));
    const worker = createWorkerProcess(
      { ...env, OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: `${fakeOrigin}/v1`,
          maxRetries: 0,
        },
      },
    );
    const inspector = new BullMqJobQueue({ url: valkey.url });
    const port = await web.listen();
    await worker.start();
    const origin = `http://127.0.0.1:${String(port)}`;

    const connection = await fetchJson(
      `${origin}/v1/model-provider-connections`,
      {
        method: "POST",
        body: {
          key: "conn-stream-routing",
          name: "Stream routing",
          provider: "OPENAI",
        },
      },
    );
    const connectionId = (connection.body as { id: string }).id;
    const connectionVersion = await fetchJson(
      `${origin}/v1/model-provider-connections/${connectionId}/versions`,
      {
        method: "POST",
        body: {
          endpoint: { baseUrl: `${fakeOrigin}/v1`, allowPrivateNetworks: true },
          credentialRef: { key: "OPENAI_API_KEY" },
        },
      },
    );
    const connectionVersionId = (connectionVersion.body as { id: string }).id;

    const profile = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: { key: "stream-routed", name: "Stream Routed" },
    });
    const modelProfileId = (profile.body as { id: string }).id;
    const version = await fetchJson(
      `${origin}/v1/model-profiles/${modelProfileId}/versions`,
      {
        method: "POST",
        body: {
          provider: "OPENAI",
          model: "gpt-test-snapshot",
          modelProviderConnectionVersionId: connectionVersionId,
          pricing: {
            currency: "USD",
            inputUsdMicrosPerMillionTokens: 1_000_000,
            outputUsdMicrosPerMillionTokens: 2_000_000,
          },
        },
      },
    );
    const streamModelProfileVersionId = (version.body as { id: string }).id;

    const agent = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: { key: "model-stream-text-agent", name: "Stream Text" },
    });
    const agentId = (agent.body as { id: string }).id;
    const agentVersion = await fetchJson(
      `${origin}/v1/agents/${agentId}/versions`,
      {
        method: "POST",
        body: {
          manifest: {
            schemaVersion: "1",
            key: "model-stream-text-agent",
            name: "Stream Text",
            runtime: {
              type: "TRUSTED_TYPESCRIPT",
              entrypoint: fixtureName,
              integrity,
            },
            input: { schema: {} },
            output: { schema: {} },
            execution: { timeoutMs: 12_000, maxAttempts: 1 },
            capabilities: { model: true, tools: [] },
            models: {
              primary: { modelProfileVersionId: streamModelProfileVersionId },
            },
          },
        },
      },
    );

    return {
      origin,
      worker,
      web,
      inspector,
      agentId,
      agentVersionId: (agentVersion.body as { id: string }).id,
      streamModelProfileVersionId,
      connectionVersionId,
      async shutdown() {
        await worker.stop();
        await inspector.shutdown();
        await web.stop();
      },
    };
  }

  async function seedStreamFailStack(fakeOrigin: string) {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-routing-stream-fail-"),
    );
    const fixtureName = "model-stream-fail-agent.ts";
    await fs.copyFile(
      path.join(FIXTURE_DIR, fixtureName),
      path.join(trustedRuntimeRoot, fixtureName),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, fixtureName)),
    );
    const env = {
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
      OPENAI_API_KEY: "test-key",
    };

    const web = createWebProcess(withTestAuthEnv(env));
    const worker = createWorkerProcess(
      { ...env, OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: `${fakeOrigin}/v1`,
          maxRetries: 0,
        },
      },
    );
    const inspector = new BullMqJobQueue({ url: valkey.url });
    const port = await web.listen();
    await worker.start();
    const origin = `http://127.0.0.1:${String(port)}`;

    const connection = await fetchJson(
      `${origin}/v1/model-provider-connections`,
      {
        method: "POST",
        body: {
          key: "conn-stream-fail",
          name: "Stream fail",
          provider: "OPENAI",
        },
      },
    );
    const connectionId = (connection.body as { id: string }).id;
    const connectionVersion = await fetchJson(
      `${origin}/v1/model-provider-connections/${connectionId}/versions`,
      {
        method: "POST",
        body: {
          endpoint: { baseUrl: `${fakeOrigin}/v1`, allowPrivateNetworks: true },
          credentialRef: { key: "OPENAI_API_KEY" },
        },
      },
    );
    const connectionVersionId = (connectionVersion.body as { id: string }).id;

    const failProfile = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: { key: "stream-fail-primary", name: "Stream Fail Primary" },
    });
    const failProfileId = (failProfile.body as { id: string }).id;
    const failVersion = await fetchJson(
      `${origin}/v1/model-profiles/${failProfileId}/versions`,
      {
        method: "POST",
        body: {
          provider: "OPENAI",
          model: "gpt-test-snapshot",
          modelProviderConnectionVersionId: connectionVersionId,
          pricing: {
            currency: "USD",
            inputUsdMicrosPerMillionTokens: 1_000_000,
            outputUsdMicrosPerMillionTokens: 2_000_000,
          },
        },
      },
    );
    const streamFailModelProfileVersionId = (failVersion.body as { id: string })
      .id;

    const cheapProfile = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: { key: "stream-fail-fallback", name: "Stream Fail Fallback" },
    });
    const cheapProfileId = (cheapProfile.body as { id: string }).id;
    const cheapVersion = await fetchJson(
      `${origin}/v1/model-profiles/${cheapProfileId}/versions`,
      {
        method: "POST",
        body: {
          provider: "OPENAI",
          model: "gpt-routing-cheap",
          modelProviderConnectionVersionId: connectionVersionId,
          pricing: {
            currency: "USD",
            inputUsdMicrosPerMillionTokens: 100_000,
            outputUsdMicrosPerMillionTokens: 100_000,
          },
        },
      },
    );
    const streamFallbackModelProfileVersionId = (
      cheapVersion.body as { id: string }
    ).id;

    const agent = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: { key: "model-stream-fail-agent", name: "Stream Fail" },
    });
    const agentId = (agent.body as { id: string }).id;
    const agentVersion = await fetchJson(
      `${origin}/v1/agents/${agentId}/versions`,
      {
        method: "POST",
        body: {
          manifest: {
            schemaVersion: "1",
            key: "model-stream-fail-agent",
            name: "Stream Fail",
            runtime: {
              type: "TRUSTED_TYPESCRIPT",
              entrypoint: fixtureName,
              integrity,
            },
            input: { schema: {} },
            output: { schema: {} },
            execution: { timeoutMs: 12_000, maxAttempts: 1 },
            capabilities: { model: true, tools: [] },
            models: {
              primary: {
                modelProfileVersionId: streamFailModelProfileVersionId,
              },
            },
          },
        },
      },
    );

    return {
      origin,
      worker,
      web,
      inspector,
      agentId,
      agentVersionId: (agentVersion.body as { id: string }).id,
      streamFailModelProfileVersionId,
      streamFallbackModelProfileVersionId,
      async shutdown() {
        await worker.stop();
        await inspector.shutdown();
        await web.stop();
      },
    };
  }

  it("R1: routing disabled leaves decision table empty", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await seedRunStack(fakeOpenAI.origin);
    try {
      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);
      expect(await decisionCount()).toBe(0);
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  });

  it("R3: LOWEST_ESTIMATED_COST selects the cheaper authorized candidate", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await seedRunStack(fakeOpenAI.origin);
    try {
      const policy = await fetchJson(
        `${stack.origin}/v1/inference-routing-policies`,
        {
          method: "POST",
          body: {
            key: "cost",
            definition: {
              schemaVersion: "1",
              strategy: "LOWEST_ESTIMATED_COST",
              candidateModelProfileVersionIds: [
                stack.modelProfileVersionId,
                stack.cheapModelProfileVersionId,
              ],
              maxProviderAttempts: 1,
              unknownCostBehavior: "EXCLUDE_FROM_RANKING",
            },
          },
        },
      );
      expect(policy.status).toBe(201);
      const policyVersionId = (policy.body as { version: { id: string } })
        .version.id;
      await fetchJson(
        `${stack.origin}/v1/inference-routing-policies/activate`,
        {
          method: "POST",
          body: { policyVersionId, enabled: true },
        },
      );

      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);

      const decision = (
        await database.sql`
          SELECT decision_json
          FROM inference_routing_decisions
          LIMIT 1
        `
      )[0] as {
        decision_json: { selectedModelProfileVersionId: string };
      };
      expect(decision.decision_json.selectedModelProfileVersionId).toBe(
        stack.cheapModelProfileVersionId,
      );

      const providerModel = fakeOpenAI.requests
        .map((request) => request.body)
        .find(
          (body): body is { model: string } =>
            body !== null &&
            typeof body === "object" &&
            "model" in body &&
            typeof (body as { model: unknown }).model === "string",
        )?.model;
      expect(providerModel).toBe("gpt-routing-cheap");
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  });

  it("R2/R11: fixed routing persists an inspectable workspace-scoped decision", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await seedRunStack(fakeOpenAI.origin);
    try {
      const policy = await fetchJson(
        `${stack.origin}/v1/inference-routing-policies`,
        {
          method: "POST",
          body: {
            key: "default",
            definition: {
              schemaVersion: "1",
              strategy: "FIXED",
              candidateModelProfileVersionIds: [stack.modelProfileVersionId],
              preferredModelProfileVersionId: stack.modelProfileVersionId,
              maxProviderAttempts: 1,
            },
          },
        },
      );
      expect(policy.status).toBe(201);
      const policyVersionId = (policy.body as { version: { id: string } })
        .version.id;
      const activated = await fetchJson(
        `${stack.origin}/v1/inference-routing-policies/activate`,
        {
          method: "POST",
          body: { policyVersionId, enabled: true },
        },
      );
      expect(activated.status).toBe(200);

      const runId = await executeRun(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
      );
      expect(await decisionCount()).toBe(1);

      const row = (
        await database.sql`
          SELECT id, decision_json
          FROM inference_routing_decisions
          LIMIT 1
        `
      )[0] as { id: string; decision_json: { runId?: string } };
      expect(row.decision_json.runId).toBe(runId);

      const decisionGet = await fetchJson(
        `${stack.origin}/v1/inference-routing-decisions/${row.id}`,
      );
      expect(decisionGet.status).toBe(200);
      expect(
        (decisionGet.body as { selectedModelProfileVersionId: string })
          .selectedModelProfileVersionId,
      ).toBe(stack.modelProfileVersionId);
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  });

  it("R4: retryable fallback invokes two provider models in order", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await seedRunStack(fakeOpenAI.origin);
    try {
      const failModelProfileVersionId = await stack.createModelVersion({
        key: "routing-fail",
        model: "gpt-routing-retry-429",
      });
      await activatePolicy(stack.origin, {
        key: "fallback",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [
            failModelProfileVersionId,
            stack.cheapModelProfileVersionId,
          ],
          allowFallback: true,
          maxProviderAttempts: 2,
        },
      });

      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);

      const counts = providerModelCounts(fakeOpenAI);
      expect(counts.get("gpt-routing-retry-429")).toBe(1);
      expect(counts.get("gpt-routing-cheap")).toBe(1);

      const decision = (
        await database.sql`
          SELECT decision_json FROM inference_routing_decisions LIMIT 1
        `
      )[0] as {
        decision_json: {
          providerAttemptCount: number;
          fallbackCount: number;
          attempts: Array<{ outcome: string }>;
          selectedModelProfileVersionId: string;
        };
      };
      expect(decision.decision_json.providerAttemptCount).toBe(2);
      expect(decision.decision_json.fallbackCount).toBe(1);
      expect(decision.decision_json.attempts.map((a) => a.outcome)).toEqual([
        "FAILED",
        "SUCCEEDED",
      ]);
      expect(decision.decision_json.selectedModelProfileVersionId).toBe(
        stack.cheapModelProfileVersionId,
      );
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  });

  it("R5: foreign workspace candidate is never invoked", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await seedRunStack(fakeOpenAI.origin);
    try {
      const workspaces = new PostgresWorkspaceRepository(database);
      await workspaces.save(
        Workspace.create({
          id: WORKSPACE_B,
          name: "Workspace B",
          createdAt: NOW,
        }),
      );
      const profiles = new PostgresModelProfileRepository(database);
      const foreignProfileId =
        randomUUID() as import("@osva-ai/contracts").ModelProfileId;
      const foreignVersionId =
        randomUUID() as import("@osva-ai/contracts").ModelProfileVersionId;
      await profiles.saveModelProfile(
        ModelProfile.create({
          id: foreignProfileId,
          workspaceId: WORKSPACE_B,
          key: "foreign",
          name: "Foreign",
          createdAt: NOW,
        }),
      );
      await profiles.appendModelProfileVersion(
        ModelProfileVersion.create({
          id: foreignVersionId,
          modelProfileId: foreignProfileId,
          version: 1,
          provider: "OPENAI",
          model: "gpt-foreign",
          createdAt: NOW,
        }),
      );

      await activatePolicy(stack.origin, {
        key: "foreign",
        definition: {
          schemaVersion: "1",
          strategy: "FIXED",
          candidateModelProfileVersionIds: [foreignVersionId],
          preferredModelProfileVersionId: foreignVersionId,
        },
      });

      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: stack.agentId,
          agentVersionId: stack.agentVersionId,
          input: { prompt: "routing-r5" },
        },
      });
      expect(created.status).toBe(201);
      const runId = (created.body as { run: { id: string } }).run.id;
      let terminal = "RUNNING";
      for (let i = 0; i < 60; i += 1) {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        if (run.status === 200) {
          terminal = (run.body as { status?: string }).status ?? terminal;
          if (terminal === "FAILED" || terminal === "SUCCEEDED") {
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(terminal).toBe("FAILED");
      expect(fakeOpenAI.requests.length).toBe(0);
      expect(await decisionCount()).toBe(0);
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  });

  it("R6: soft estimated-cost admission rejects before any provider call", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await seedRunStack(fakeOpenAI.origin);
    try {
      await activatePolicy(stack.origin, {
        key: "budget",
        definition: {
          schemaVersion: "1",
          strategy: "FIXED",
          candidateModelProfileVersionIds: [stack.modelProfileVersionId],
          preferredModelProfileVersionId: stack.modelProfileVersionId,
          maxEstimatedCostUsdMicros: 1,
        },
      });

      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: stack.agentId,
          agentVersionId: stack.agentVersionId,
          input: { prompt: "budget" },
        },
      });
      expect(created.status).toBe(201);
      const runId = (created.body as { run: { id: string } }).run.id;
      expect(await waitForRunStatus(stack.origin, runId)).toBe("FAILED");
      expect(fakeOpenAI.requests.length).toBe(0);
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  });

  it("R7: routed streaming selects the policy model and records one MODEL step", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await seedStreamStack(fakeOpenAI.origin);
    try {
      await activatePolicy(stack.origin, {
        key: "stream-fixed",
        definition: {
          schemaVersion: "1",
          strategy: "FIXED",
          candidateModelProfileVersionIds: [stack.streamModelProfileVersionId],
          preferredModelProfileVersionId: stack.streamModelProfileVersionId,
          maxProviderAttempts: 1,
        },
      });

      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: stack.agentId,
          agentVersionId: stack.agentVersionId,
          input: { prompt: "routing-stream-r7" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });

      expect(fakeOpenAI.requests).toHaveLength(1);
      const requestedModel = (
        fakeOpenAI.requests[0]?.body as { model?: string } | null
      )?.model;
      expect(requestedModel).toBe("gpt-test-snapshot");
      expect(await decisionCount()).toBe(1);

      const attempt = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          text: "normalized text from fake openai",
          deltas: expect.arrayContaining([expect.any(String)]),
        },
      });

      const steps = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      const stepList = (steps.body as { steps: Array<Record<string, unknown>> })
        .steps;
      expect(stepList).toHaveLength(1);
      expect(stepList[0]).toMatchObject({
        kind: "MODEL",
        status: "SUCCEEDED",
        modelProfileVersionId: stack.streamModelProfileVersionId,
      });
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  }, 90_000);

  it("R8: mid-stream failure does not invoke fallback or fabricate completion", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await seedStreamFailStack(fakeOpenAI.origin);
    try {
      await activatePolicy(stack.origin, {
        key: "stream-fail",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [
            stack.streamFailModelProfileVersionId,
            stack.streamFallbackModelProfileVersionId,
          ],
          allowFallback: true,
          maxProviderAttempts: 2,
        },
      });

      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: stack.agentId,
          agentVersionId: stack.agentVersionId,
          input: { prompt: "routing-stream-r8" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "FAILED"
        );
      });

      const counts = providerModelCounts(fakeOpenAI);
      expect(counts.get("gpt-test-snapshot")).toBe(1);
      expect(counts.get("gpt-routing-cheap") ?? 0).toBe(0);
      expect(fakeOpenAI.requests).toHaveLength(1);

      const attempt = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({ status: "FAILED" });

      const steps = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      const stepList = (steps.body as { steps: Array<Record<string, unknown>> })
        .steps;
      expect(stepList).toHaveLength(1);
      expect(stepList[0]).toMatchObject({
        kind: "MODEL",
        status: "FAILED",
      });
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  }, 90_000);

  it("R9: Valkey exact-response cache isolates routed models", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await seedRunStack(fakeOpenAI.origin, { withCache: true });
    const runs = new PostgresRunRepository(database);
    try {
      const connectionB = await fetchJson(
        `${stack.origin}/v1/model-provider-connections`,
        {
          method: "POST",
          body: {
            key: "conn-cache-b",
            name: "Cache B connection",
            provider: "OPENAI",
          },
        },
      );
      const connectionBId = (connectionB.body as { id: string }).id;
      const connectionBVersion = await fetchJson(
        `${stack.origin}/v1/model-provider-connections/${connectionBId}/versions`,
        {
          method: "POST",
          body: {
            endpoint: {
              baseUrl: `${fakeOpenAI.origin}/v1`,
              allowPrivateNetworks: true,
            },
            credentialRef: { key: "OPENAI_API_KEY" },
          },
        },
      );
      const connectionBVersionId = (connectionBVersion.body as { id: string })
        .id;

      const modelA = await stack.createModelVersion({
        key: "cache-a",
        model: "gpt-routing-response-a",
        modelProviderConnectionVersionId: stack.connectionVersionId,
      });
      const modelB = await stack.createModelVersion({
        key: "cache-b",
        model: "gpt-routing-response-b",
        modelProviderConnectionVersionId: connectionBVersionId,
      });

      const policyA = await fetchJson(
        `${stack.origin}/v1/inference-routing-policies`,
        {
          method: "POST",
          body: {
            key: "cache-route-a",
            definition: {
              schemaVersion: "1",
              strategy: "FIXED",
              candidateModelProfileVersionIds: [modelA],
              preferredModelProfileVersionId: modelA,
              maxProviderAttempts: 1,
            },
          },
        },
      );
      const policyVersionA = (policyA.body as { version: { id: string } })
        .version.id;
      await fetchJson(
        `${stack.origin}/v1/inference-routing-policies/activate`,
        {
          method: "POST",
          body: { policyVersionId: policyVersionA, enabled: true },
        },
      );

      expect(await countCacheKeys()).toBe(0);
      const missA = await executeRunWithAttempt(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
      );
      expect(
        providerModelCounts(fakeOpenAI).get("gpt-routing-response-a"),
      ).toBe(1);
      expect(await countCacheKeys()).toBeGreaterThan(0);
      const [cacheKey] = await redis.keys(
        `${INFERENCE_CACHE_STORAGE_KEY_PREFIX}*`,
      );
      const stored = await redis.get(cacheKey!);
      expect(stored).not.toBeNull();
      expect(isEncryptedCacheWire(stored!)).toBe(true);

      const hitA = await executeRunWithAttempt(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
      );
      expect(
        providerModelCounts(fakeOpenAI).get("gpt-routing-response-a"),
      ).toBe(1);
      const stepsHitA = await runs.listRunSteps({
        runAttemptId:
          hitA.runAttemptId as import("@osva-ai/contracts").RunAttemptId,
        limit: 5,
      });
      expect(stepsHitA.steps[0]?.modelInvocationSource).toBe(
        "OSVA_RESPONSE_CACHE_HIT",
      );
      const usageHitA = await runs.aggregateRunAttemptUsage(
        hitA.runAttemptId as import("@osva-ai/contracts").RunAttemptId,
      );
      expect(usageHitA.modelCalls).toBe(0);

      const policyB = await fetchJson(
        `${stack.origin}/v1/inference-routing-policies`,
        {
          method: "POST",
          body: {
            key: "cache-route-b",
            definition: {
              schemaVersion: "1",
              strategy: "FIXED",
              candidateModelProfileVersionIds: [modelB],
              preferredModelProfileVersionId: modelB,
              maxProviderAttempts: 1,
            },
          },
        },
      );
      const policyVersionB = (policyB.body as { version: { id: string } })
        .version.id;
      await fetchJson(
        `${stack.origin}/v1/inference-routing-policies/activate`,
        {
          method: "POST",
          body: { policyVersionId: policyVersionB, enabled: true },
        },
      );

      const missB = await executeRunWithAttempt(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
      );
      expect(
        providerModelCounts(fakeOpenAI).get("gpt-routing-response-b"),
      ).toBe(1);
      const attemptMissB = await fetchJson(
        `${stack.origin}/v1/runs/${missB.runId}/attempts/${missB.runAttemptId}`,
      );
      expect(
        (attemptMissB.body as { output?: { text?: string } }).output?.text,
      ).toBe("cached-response-b");

      const hitB = await executeRunWithAttempt(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
      );
      expect(
        providerModelCounts(fakeOpenAI).get("gpt-routing-response-b"),
      ).toBe(1);
      const stepsHitB = await runs.listRunSteps({
        runAttemptId:
          hitB.runAttemptId as import("@osva-ai/contracts").RunAttemptId,
        limit: 5,
      });
      expect(stepsHitB.steps[0]?.modelInvocationSource).toBe(
        "OSVA_RESPONSE_CACHE_HIT",
      );

      await fetchJson(
        `${stack.origin}/v1/inference-routing-policies/activate`,
        {
          method: "POST",
          body: { policyVersionId: policyVersionA, enabled: true },
        },
      );
      const hitAAgain = await executeRunWithAttempt(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
      );
      expect(
        providerModelCounts(fakeOpenAI).get("gpt-routing-response-a"),
      ).toBe(1);
      expect(
        providerModelCounts(fakeOpenAI).get("gpt-routing-response-b"),
      ).toBe(1);
      const stepsAAgain = await runs.listRunSteps({
        runAttemptId:
          hitAAgain.runAttemptId as import("@osva-ai/contracts").RunAttemptId,
        limit: 5,
      });
      expect(stepsAAgain.steps[0]?.modelInvocationSource).toBe(
        "OSVA_RESPONSE_CACHE_HIT",
      );
      const usageMissA = await runs.aggregateRunAttemptUsage(
        missA.runAttemptId as import("@osva-ai/contracts").RunAttemptId,
      );
      expect(usageMissA.modelCalls).toBe(1);
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  }, 180_000);

  it("R10: policy circuit breaker opens and routes to fallback", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await seedRunStack(fakeOpenAI.origin);
    try {
      const failModelProfileVersionId = await stack.createModelVersion({
        key: "breaker-fail",
        model: "gpt-routing-retry-429",
      });
      await activatePolicy(stack.origin, {
        key: "breaker",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [
            failModelProfileVersionId,
            stack.cheapModelProfileVersionId,
          ],
          allowFallback: true,
          maxProviderAttempts: 1,
          circuitBreaker: {
            failureThreshold: 2,
            windowMs: 60_000,
            openDurationMs: 120_000,
          },
        },
      });

      for (let i = 0; i < 2; i += 1) {
        const created = await fetchJson(`${stack.origin}/v1/runs`, {
          method: "POST",
          body: {
            agentId: stack.agentId,
            agentVersionId: stack.agentVersionId,
            input: { prompt: `breaker-warmup-${String(i)}` },
          },
        });
        const runId = (created.body as { run: { id: string } }).run.id;
        expect(await waitForRunStatus(stack.origin, runId)).toBe("FAILED");
      }

      fakeOpenAI.requests.length = 0;
      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);
      const counts = providerModelCounts(fakeOpenAI);
      expect(counts.get("gpt-routing-retry-429") ?? 0).toBe(0);
      expect(counts.get("gpt-routing-cheap")).toBe(1);
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  }, 120_000);

  it("R12: routing disabled preserves bound model path", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await seedRunStack(fakeOpenAI.origin);
    try {
      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);
      const counts = providerModelCounts(fakeOpenAI);
      expect(counts.get("gpt-routing-test")).toBe(1);
      expect(await decisionCount()).toBe(0);
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  });
});

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("waitUntil timed out");
}
