import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { isEncryptedCacheWire } from "@osva/adapters-inference-cache-valkey";
import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import type { SecurityAuditEventId, WorkspaceId } from "@osva-ai/contracts";
import {
  INFERENCE_CACHE_STORAGE_KEY_PREFIX,
  SECURITY_AUDIT_EVENT_TYPES,
} from "@osva-ai/contracts";
import {
  createDatabase,
  migrateDatabase,
  PostgresRunRepository,
  PostgresWorkspaceInferenceCachePolicyRepository,
  type Database,
} from "@osva/db";
import { SecurityAuditEvent } from "@osva/domain";
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
import {
  composeInferenceResponseCache,
  resolveInferenceResponseCacheEnabled,
} from "../../src/inference-response-cache.js";
import { loadWorkerConfig } from "../../src/config.js";

const WORKSPACE_A = "ws-cache-prod" as WorkspaceId;
const NOW = new Date("2026-02-01T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

const PRODUCTION_KEY_B64 = Buffer.alloc(32, 21).toString("base64");

function productionCacheEnv(
  base: Record<string, string>,
): Record<string, string> {
  return {
    ...base,
    OSVA_EXACT_RESPONSE_CACHE_ENABLED: "true",
    OSVA_INFERENCE_CACHE_ENCRYPTION_ACTIVE_KEY_ID: "production-acceptance",
    OSVA_INFERENCE_CACHE_ENCRYPTION_ACTIVE_KEY_B64: PRODUCTION_KEY_B64,
  };
}

describe("exact-response cache production worker composition", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;
  let redis: Redis;
  let policies: PostgresWorkspaceInferenceCachePolicyRepository;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    policies = new PostgresWorkspaceInferenceCachePolicyRepository(database);
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

  async function persistWorkspacePolicy(input: {
    readonly enabled: boolean;
    readonly updatedAt: Date;
    readonly revokedAt?: Date;
  }): Promise<void> {
    await policies.upsertWithAudit({
      record: {
        schemaVersion: "1",
        workspaceId: WORKSPACE_A,
        enabled: input.enabled,
        determinism: "REQUIRED_DETERMINISTIC",
        ttlSeconds: 3_600,
        revokedAt: input.revokedAt?.toISOString(),
        updatedAt: input.updatedAt.toISOString(),
      },
      auditEvent: SecurityAuditEvent.create({
        id: crypto.randomUUID() as SecurityAuditEventId,
        eventType:
          SECURITY_AUDIT_EVENT_TYPES.WORKSPACE_INFERENCE_CACHE_POLICY_UPSERTED,
        occurredAt: input.updatedAt,
        workspaceId: WORKSPACE_A,
        details: { enabled: input.enabled },
      }),
    });
  }

  async function seedProductionStack(fakeOrigin: string) {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-erc-prod-runtime-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "model-text-agent.ts"),
      path.join(trustedRuntimeRoot, "model-text-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "model-text-agent.ts")),
    );

    const workerEnv = productionCacheEnv({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
      OPENAI_API_KEY: "test-key",
    });

    const web = createWebProcess(withTestAuthEnv(workerEnv));
    const worker = createWorkerProcess(
      {
        ...workerEnv,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      },
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
    input: Record<string, unknown> = { prompt: "cache-acceptance" },
  ): Promise<{ runId: string; runAttemptId: string }> {
    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        agentId,
        agentVersionId,
        input,
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

    return { runId, runAttemptId };
  }

  it("Run A/B: DB-backed policy, env compose, encrypted Valkey", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    await persistWorkspacePolicy({ enabled: true, updatedAt: NOW });

    const stack = await seedProductionStack(fakeOpenAI.origin);
    const runs = new PostgresRunRepository(database);

    try {
      const runA = await executeRun(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
      );
      expect(fakeOpenAI.requests).toHaveLength(1);

      const keys = await redis.keys(`${INFERENCE_CACHE_STORAGE_KEY_PREFIX}*`);
      expect(keys.length).toBeGreaterThan(0);
      const stored = await redis.get(keys[0]!);
      expect(isEncryptedCacheWire(stored!)).toBe(true);

      const stepsA = await runs.listRunSteps({
        runAttemptId:
          runA.runAttemptId as import("@osva-ai/contracts").RunAttemptId,
        limit: 10,
      });
      expect(stepsA.steps[0]?.modelInvocationSource).toMatch(
        /^PROVIDER_(INVOKED|PROMPT_CACHE_HIT)$/,
      );
      expect(stepsA.steps[0]?.inputTokens).toBeGreaterThan(0);

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

      const usageB = await runs.aggregateRunAttemptUsage(
        runB.runAttemptId as import("@osva-ai/contracts").RunAttemptId,
      );
      expect(usageB.modelCalls).toBe(0);
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  });

  it("revocation and re-enablement use fresh policy revision (no stale reuse)", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const t0 = NOW;
    const tRevoke = new Date(NOW.getTime() + 60_000);
    const tReenable = new Date(NOW.getTime() + 120_000);

    await persistWorkspacePolicy({ enabled: true, updatedAt: t0 });
    const stack = await seedProductionStack(fakeOpenAI.origin);

    try {
      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);
      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);
      expect(fakeOpenAI.requests).toHaveLength(1);

      await persistWorkspacePolicy({
        enabled: false,
        updatedAt: tRevoke,
        revokedAt: tRevoke,
      });

      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);
      expect(fakeOpenAI.requests).toHaveLength(2);

      await persistWorkspacePolicy({
        enabled: true,
        updatedAt: tReenable,
      });

      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);
      expect(fakeOpenAI.requests).toHaveLength(3);

      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);
      expect(fakeOpenAI.requests).toHaveLength(3);
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  });

  it("missing workspace policy keeps caching disabled", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await seedProductionStack(fakeOpenAI.origin);
    try {
      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);
      await executeRun(stack.origin, stack.agentId, stack.agentVersionId);
      expect(fakeOpenAI.requests).toHaveLength(2);
      const keys = await redis.keys(`${INFERENCE_CACHE_STORAGE_KEY_PREFIX}*`);
      expect(keys.length).toBe(0);
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  });

  it("rejects forged cache policy fields on HTTP create run", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    await persistWorkspacePolicy({ enabled: true, updatedAt: NOW });
    const stack = await seedProductionStack(fakeOpenAI.origin);
    try {
      const forged = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: stack.agentId,
          agentVersionId: stack.agentVersionId,
          input: { prompt: "cache-acceptance" },
          inferenceResponseCache: {
            schemaVersion: "1",
            enabled: true,
            determinism: "REQUIRED_DETERMINISTIC",
          },
          policyContext: { inferenceResponseCache: { enabled: true } },
        },
      });
      expect(forged.status).toBe(400);
    } finally {
      await stack.shutdown();
      await fakeOpenAI.close();
    }
  });

  it("fails compose when encryption env is missing", () => {
    const config = loadWorkerConfig({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
    });
    expect(() =>
      composeInferenceResponseCache({
        config,
        env: { OSVA_EXACT_RESPONSE_CACHE_ENABLED: "true" },
      }),
    ).toThrow("OSVA_INFERENCE_CACHE_ENCRYPTION_ACTIVE_KEY_ID");
  });

  it("env flag absent means cache composition disabled", () => {
    expect(
      resolveInferenceResponseCacheEnabled({
        OSVA_EXACT_RESPONSE_CACHE_ENABLED: undefined,
      }),
    ).toBe(false);
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
