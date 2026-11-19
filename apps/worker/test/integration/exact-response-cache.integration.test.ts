import crypto from "node:crypto";
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
import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import type {
  InferenceResponseCachePolicyV1,
  WorkspaceId,
} from "@osva-ai/contracts";
import { INFERENCE_CACHE_STORAGE_KEY_PREFIX } from "@osva-ai/contracts";
import {
  createDatabase,
  migrateDatabase,
  PostgresRunRepository,
  PostgresWorkspaceRepository,
  PostgresApiKeyRepository,
  type Database,
} from "@osva/db";
import { COMMUNITY_EDITION_ROLES } from "@osva-ai/contracts";
import { createApiKeyApplication, Workspace } from "@osva/domain";
import { Redis } from "ioredis";
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
import {
  bootstrapIntegrationAuth,
  fetchJson,
  integrationAuth,
} from "./integration-auth.js";
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

const WORKSPACE_A = "ws-cache-a" as WorkspaceId;
const WORKSPACE_B = "ws-cache-b" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
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

describe("exact-response cache worker acceptance", () => {
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
      connectTimeoutSeconds: 10,
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
    await bootstrapIntegrationAuth(database, WORKSPACE_A, NOW);
    await redis.flushdb();
  });

  afterEach(async () => {
    await redis.flushdb();
  });

  async function countCacheKeys(): Promise<number> {
    const keys = await redis.keys(`${INFERENCE_CACHE_STORAGE_KEY_PREFIX}*`);
    return keys.length;
  }

  async function seedTrustedModelStack(input: {
    readonly fakeOrigin: string;
    readonly workerEnv: Record<string, string>;
    readonly withCache: boolean;
  }) {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-erc-runtime-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "model-text-agent.ts"),
      path.join(trustedRuntimeRoot, "model-text-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "model-text-agent.ts")),
    );

    const web = createWebProcess(withTestAuthEnv(input.workerEnv));
    const cache =
      input.withCache === true
        ? new ValkeyExactResponseCache({
            url: valkey.url,
            wireProtection: createAesGcmWireProtection({
              keyRing: INTEGRATION_CACHE_KEY_RING,
              rejectLegacyPlaintext: true,
            }),
          })
        : undefined;
    const worker = createWorkerProcess(
      {
        ...input.workerEnv,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: `${input.fakeOrigin}/v1`,
          maxRetries: 0,
        },
        exactResponseCache: cache,
        trustedInferenceResponseCachePolicy:
          input.withCache === true ? TRUSTED_CACHE_POLICY : undefined,
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
          key: `conn-${randomSuffix()}`,
          name: "Cache test connection",
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
            baseUrl: `${input.fakeOrigin}/v1`,
            allowPrivateNetworks: true,
          },
          credentialRef: { key: "OPENAI_API_KEY" },
        },
      },
    );
    const connectionVersionId = (connectionVersion.body as { id: string }).id;

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
          model: "gpt-cache-test",
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

    return {
      origin,
      worker,
      web,
      inspector,
      agentId,
      agentVersionId,
      modelProfileVersionId,
      async shutdown() {
        await worker.stop();
        await inspector.shutdown();
        await web.stop();
      },
    };
  }

  async function executeRun(
    origin: string,
    agentId: string,
    agentVersionId: string,
  ): Promise<{ runId: string; runAttemptId: string }> {
    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        agentId,
        agentVersionId,
        input: { prompt: "cache-acceptance" },
      },
    });
    expect(created.status).toBe(201);
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

    return {
      runId,
      runAttemptId: runAttemptId as string,
    };
  }

  it("scenario A/B: first run invokes provider and caches; second run is an OSVA cache hit", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const env = {
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
      OPENAI_API_KEY: "test-key",
    };

    const stack = await seedTrustedModelStack({
      fakeOrigin: fakeOpenAI.origin,
      workerEnv: env,
      withCache: true,
    });
    const runs = new PostgresRunRepository(database);

    try {
      const beforeKeys = await countCacheKeys();
      expect(beforeKeys).toBe(0);

      const runA = await executeRun(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
      );
      expect(fakeOpenAI.requests).toHaveLength(1);
      expect(await countCacheKeys()).toBeGreaterThan(0);
      const [cacheKey] = await redis.keys(
        `${INFERENCE_CACHE_STORAGE_KEY_PREFIX}*`,
      );
      expect(cacheKey).toBeDefined();
      const stored = await redis.get(cacheKey!);
      expect(stored).not.toBeNull();
      expect(isEncryptedCacheWire(stored!)).toBe(true);
      expect(stored).not.toContain("world");

      const stepsA = await runs.listRunSteps({
        runAttemptId:
          runA.runAttemptId as import("@osva-ai/contracts").RunAttemptId,
        limit: 10,
      });
      expect(stepsA.steps).toHaveLength(1);
      expect(stepsA.steps[0]?.modelInvocationSource).not.toBe(
        "OSVA_RESPONSE_CACHE_HIT",
      );
      expect(stepsA.steps[0]?.modelInvocationSource).toMatch(
        /^PROVIDER_(INVOKED|PROMPT_CACHE_HIT)$/,
      );
      expect(stepsA.steps[0]?.inputTokens).toBeGreaterThan(0);
      expect(stepsA.steps[0]?.providerRequestId).toEqual(expect.any(String));

      const usageA = await runs.aggregateRunAttemptUsage(
        runA.runAttemptId as import("@osva-ai/contracts").RunAttemptId,
      );
      expect(usageA.modelCalls).toBe(1);

      const runB = await executeRun(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
      );
      expect(fakeOpenAI.requests).toHaveLength(1);

      const stepsB = await runs.listRunSteps({
        runAttemptId:
          runB.runAttemptId as import("@osva-ai/contracts").RunAttemptId,
        limit: 10,
      });
      expect(stepsB.steps[0]?.modelInvocationSource).toBe(
        "OSVA_RESPONSE_CACHE_HIT",
      );
      expect(stepsB.steps[0]?.providerRequestId).toBeUndefined();
      expect(stepsB.steps[0]?.inputTokens).toBeUndefined();
      expect(stepsB.steps[0]?.estimatedCostUsdMicros).toBeNull();
      expect(stepsB.steps[0]?.estimatedAvoidedCostUsdMicros).toBeNull();

      const usageB = await runs.aggregateRunAttemptUsage(
        runB.runAttemptId as import("@osva-ai/contracts").RunAttemptId,
      );
      expect(usageB.modelCalls).toBe(0);
      expect(usageB.inputTokens).toBe(0);

      const attemptBUsage = await fetchJson(
        `${stack.origin}/v1/runs/${runB.runId}/attempts/${runB.runAttemptId}/usage`,
      );
      expect(attemptBUsage.body).toMatchObject({
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
      });
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  });

  it("scenario C: without cache port, each run invokes the provider", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const env = {
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
      OPENAI_API_KEY: "test-key",
    };

    const stack = await seedTrustedModelStack({
      fakeOrigin: fakeOpenAI.origin,
      workerEnv: env,
      withCache: false,
    });

    try {
      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);
      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);
      expect(fakeOpenAI.requests).toHaveLength(2);
      expect(await countCacheKeys()).toBe(0);
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  });

  it("scenario D: equivalent request in another workspace does not reuse cache", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const envA = {
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
      OPENAI_API_KEY: "test-key",
    };

    const stackA = await seedTrustedModelStack({
      fakeOrigin: fakeOpenAI.origin,
      workerEnv: envA,
      withCache: true,
    });

    try {
      await executeRun(stackA.origin, stackA.agentId, stackA.agentVersionId);
      await executeRun(stackA.origin, stackA.agentId, stackA.agentVersionId);
      expect(fakeOpenAI.requests).toHaveLength(1);

      await stackA.shutdown();

      await new PostgresWorkspaceRepository(database).save(
        Workspace.create({
          id: WORKSPACE_B,
          name: "Workspace B",
          createdAt: NOW,
        }),
      );
      const apiKeyApp = createApiKeyApplication({
        apiKeys: new PostgresApiKeyRepository(database),
        workspaces: new PostgresWorkspaceRepository(database),
        clock: { now: () => NOW },
        ids: { createId: () => crypto.randomUUID() },
      });
      const keyB = await apiKeyApp.createApiKey.execute({
        workspaceId: WORKSPACE_B,
        name: "cache-test-b",
        role: COMMUNITY_EDITION_ROLES.ADMIN,
      });
      if (keyB.plaintextToken === undefined) {
        throw new Error("Expected workspace B API key.");
      }
      integrationAuth.token = keyB.plaintextToken;

      const stackB = await seedTrustedModelStack({
        fakeOrigin: fakeOpenAI.origin,
        workerEnv: envA,
        withCache: true,
      });

      try {
        await executeRun(stackB.origin, stackB.agentId, stackB.agentVersionId);
        expect(fakeOpenAI.requests).toHaveLength(2);
      } finally {
        await stackB.shutdown();
      }
    } finally {
      await fakeOpenAI.close();
    }
  });
});

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for run completion.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
