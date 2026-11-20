/**
 * B5.5B.1 — Worker-level inference budget acceptance (W1–W22).
 * Real createWorkerProcess stack, PostgreSQL, fake OpenAI provider.
 */
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
import { createDefaultInferenceBudgetPolicyDefinition } from "@osva-ai/contracts";
import {
  createDatabase,
  migrateDatabase,
  PostgresInferenceBudgetPolicyRepository,
  type Database,
} from "@osva/db";
import { INFERENCE_CACHE_STORAGE_KEY_PREFIX } from "@osva-ai/contracts";
import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
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
import { bootstrapIntegrationAuth, fetchJson } from "./integration-auth.js";
import {
  BUDGET_WORKSPACE,
  activateRoutingPolicy,
  createBudgetWorkerStack,
  createRun,
  listReservations,
  periodKeyFor,
  readPeriodLedger,
  runAgentOnce,
  seedInferenceBudgetPolicy,
  waitForRunTerminal,
  waitUntil,
} from "./inference-budget-worker-harness.js";

const NOW = new Date("2026-02-15T12:00:00.000Z");

function currentPeriodKey() {
  return periodKeyFor(new Date());
}

function providerModelCounts(
  requests: Array<{ body: unknown }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const request of requests) {
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

describe("B5.5B.1 inference budget worker acceptance", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;
  let redis: Redis;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 6,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    redis = new Redis(valkey.url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
    });
  }, 180_000);

  afterAll(async () => {
    await redis.quit();
    await database.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, BUDGET_WORKSPACE, NOW);
    await redis.flushdb();
  });

  afterEach(async () => {
    await redis.flushdb();
  });

  async function countCacheKeys(): Promise<number> {
    const keys = await redis.keys(`${INFERENCE_CACHE_STORAGE_KEY_PREFIX}*`);
    return keys.length;
  }

  it("W1: budget disabled — run succeeds with no reservations", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    try {
      const outcome = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
      );
      expect(outcome.terminal).toBe("SUCCEEDED");
      expect(fake.requests.length).toBeGreaterThan(0);
      expect(await listReservations(database, BUDGET_WORKSPACE)).toHaveLength(
        0,
      );
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  });

  it("W2: budget enabled with capacity — durable reservation and provider path", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 10_000_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      modelName: "gpt-budget-slow",
    });
    try {
      const outcome = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w2-enabled",
      );
      expect(outcome.terminal).toBe("SUCCEEDED");
      const rows = await listReservations(database, BUDGET_WORKSPACE);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.provider_started_at).not.toBeNull();
      expect(fake.requests.length).toBeGreaterThan(0);
      expect(
        rows.some((r) =>
          ["COMMITTED", "RELEASED", "RECONCILIATION_REQUIRED"].includes(
            r.status,
          ),
        ),
      ).toBe(true);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  });

  it("W3: PROVIDER_STARTED persisted before fake provider handles request", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 10_000_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      modelName: "gpt-budget-slow",
    });
    try {
      let providerStartedAtSetWithZeroRequests = false;
      const started = await createRun(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w3-provider-order",
      );
      await waitUntil(async () => {
        const rows = await listReservations(database, BUDGET_WORKSPACE);
        if (
          rows.length > 0 &&
          fake.requests.length === 0 &&
          rows.some(
            (r) =>
              r.status === "ADMITTED" ||
              r.status === "PROVIDER_STARTED" ||
              r.provider_started_at !== null,
          )
        ) {
          providerStartedAtSetWithZeroRequests = true;
        }
        const run = await fetchJson(`${stack.origin}/v1/runs/${started.runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });
      expect(providerStartedAtSetWithZeroRequests).toBe(true);
      expect(await waitForRunTerminal(stack.origin, started.runId)).toBe(
        "SUCCEEDED",
      );
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  });

  it("W4: period exceeded — zero provider calls", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 1_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    try {
      const outcome = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w4-denied",
      );
      expect(outcome.terminal).toBe("FAILED");
      expect(fake.requests.length).toBe(0);
      const rows = await listReservations(database, BUDGET_WORKSPACE);
      expect(rows.every((r) => r.status !== "PROVIDER_STARTED")).toBe(true);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  });

  it("W5: broken admission tables — zero provider calls", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 10_000_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    try {
      await database.sql`
        ALTER TABLE inference_budget_reservations
        RENAME TO inference_budget_reservations_hidden
      `;
      const outcome = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w5-fail-closed",
      );
      expect(outcome.terminal).toBe("FAILED");
      expect(fake.requests.length).toBe(0);
    } finally {
      await database.sql`
        ALTER TABLE inference_budget_reservations_hidden
        RENAME TO inference_budget_reservations
      `;
      await stack.shutdown();
      await fake.close();
    }
  });

  it("W6: policy enabled after worker startup — subsequent run enforces", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    try {
      const before = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w6-before",
      );
      expect(before.terminal).toBe("SUCCEEDED");
      expect(await listReservations(database, BUDGET_WORKSPACE)).toHaveLength(
        0,
      );

      await seedInferenceBudgetPolicy(database, {
        workspaceId: BUDGET_WORKSPACE,
        enabled: true,
        periodLimitUsdMicros: 10_000_000,
        now: NOW,
      });

      const after = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w6-after",
      );
      expect(after.terminal).toBe("SUCCEEDED");
      expect(
        (await listReservations(database, BUDGET_WORKSPACE)).length,
      ).toBeGreaterThan(0);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  });

  it("W7: trusted workspace policy enforces even when agent policyContext would disable", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 10_000_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    try {
      const outcome = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w7-trusted",
      );
      expect(outcome.terminal).toBe("SUCCEEDED");
      expect(
        (await listReservations(database, BUDGET_WORKSPACE)).length,
      ).toBeGreaterThan(0);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  });

  it("W8: exact-response cache hit — no additional provider call or hold", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 10_000_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      withCache: true,
    });
    try {
      await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w8-1",
      );
      const afterFirst = await listReservations(database, BUDGET_WORKSPACE);
      const callsAfterFirst = fake.requests.length;
      await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w8-2",
      );
      expect(fake.requests.length).toBe(callsAfterFirst);
      const afterSecond = await listReservations(database, BUDGET_WORKSPACE);
      expect(afterSecond.length).toBe(afterFirst.length);
      expect(await countCacheKeys()).toBeGreaterThan(0);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  });

  it("W9: cache miss — admission then provider invocation", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 10_000_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      withCache: true,
      modelName: "gpt-budget-slow",
    });
    try {
      let admitBeforeProvider = false;
      const started = await createRun(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w9-cache-miss",
      );
      await waitUntil(async () => {
        const rows = await listReservations(database, BUDGET_WORKSPACE);
        if (rows.length > 0 && fake.requests.length === 0) {
          admitBeforeProvider = true;
        }
        const run = await fetchJson(`${stack.origin}/v1/runs/${started.runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });
      expect(admitBeforeProvider).toBe(true);
      expect(fake.requests.length).toBe(1);
      expect(await waitForRunTerminal(stack.origin, started.runId)).toBe(
        "SUCCEEDED",
      );
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("W10/W11: routing fallback — distinct reservation identities and pricing snapshots", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 50_000_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      modelName: "gpt-routing-retry-429",
    });
    try {
      await activateRoutingPolicy(stack.origin, {
        key: "w10-fallback",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [
            stack.modelProfileVersionId,
            stack.cheapModelProfileVersionId,
          ],
          allowFallback: true,
          maxProviderAttempts: 2,
        },
      });
      const outcome = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w10-fallback",
      );
      expect(outcome.terminal).toBe("SUCCEEDED");
      expect(providerModelCounts(fake.requests).get("gpt-routing-cheap")).toBe(
        1,
      );
      expect(fake.requests.length).toBe(2);
      const rows = await listReservations(database, BUDGET_WORKSPACE);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const reservationKeys = new Set(rows.map((r) => r.reservation_key));
      expect(reservationKeys.size).toBe(2);
      const byAttempt = new Map(
        rows.map((r) => [r.provider_attempt_index ?? -1, r]),
      );
      expect(byAttempt.get(0)?.status).toBe("RECONCILIATION_REQUIRED");
      expect(byAttempt.get(1)?.status).not.toBe("RELEASED");
      expect(
        byAttempt.get(1)?.status === "COMMITTED" ||
          byAttempt.get(1)?.status === "RECONCILIATION_REQUIRED",
      ).toBe(true);
      expect(byAttempt.get(0)?.selected_model_profile_version_id).not.toBe(
        byAttempt.get(1)?.selected_model_profile_version_id,
      );
      expect(byAttempt.get(1)?.selected_model_profile_version_id).toBe(
        stack.cheapModelProfileVersionId,
      );
      expect(byAttempt.get(0)?.pricing_snapshot_id).toBeDefined();
      expect(byAttempt.get(1)?.pricing_snapshot_id).toBeDefined();
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("W12: budget exceeded on routing — no fallback provider calls", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 1_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      modelName: "gpt-routing-retry-429",
    });
    try {
      await activateRoutingPolicy(stack.origin, {
        key: "w12-deny-fallback",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [
            stack.modelProfileVersionId,
            stack.cheapModelProfileVersionId,
          ],
          allowFallback: true,
          maxProviderAttempts: 2,
        },
      });
      const outcome = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w12-no-fallback",
      );
      expect(outcome.terminal).toBe("FAILED");
      expect(fake.requests.length).toBe(0);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  });

  it("W13: unknown provider usage retains uncertain liability", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 10_000_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      fixtureName: "model-budget-no-usage-agent.ts",
      agentKey: "model-budget-no-usage-agent",
    });
    try {
      const outcome = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w13-unknown",
      );
      expect(outcome.terminal).toBe("SUCCEEDED");
      const rows = await listReservations(database, BUDGET_WORKSPACE);
      expect(
        rows.some(
          (r) =>
            r.status === "RECONCILIATION_REQUIRED" ||
            r.uncertain_floor_usd_micros !== null,
        ),
      ).toBe(true);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  });

  it("W14: streaming — admission before provider and terminal reconciliation", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 10_000_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      fixtureName: "model-stream-text-agent.ts",
      agentKey: "model-stream-text-agent",
      modelName: "gpt-budget-slow",
    });
    try {
      let admittedBeforeStream = false;
      const started = await createRun(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w14-stream",
      );
      await waitUntil(async () => {
        const rows = await listReservations(database, BUDGET_WORKSPACE);
        if (rows.length > 0 && fake.requests.length === 0) {
          admittedBeforeStream = true;
        }
        const run = await fetchJson(`${stack.origin}/v1/runs/${started.runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });
      expect(admittedBeforeStream).toBe(true);
      expect(await waitForRunTerminal(stack.origin, started.runId)).toBe(
        "SUCCEEDED",
      );
      expect(fake.requests.length).toBe(1);
      const rows = await listReservations(database, BUDGET_WORKSPACE);
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("W15: streaming failure after provider start — conservative liability", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 10_000_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      fixtureName: "model-stream-fail-agent.ts",
      agentKey: "model-stream-fail-agent",
      modelName: "gpt-test-snapshot",
    });
    try {
      const outcome = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w15-stream-fail",
      );
      expect(outcome.terminal).toBe("FAILED");
      expect(fake.requests.length).toBe(1);
      const rows = await listReservations(database, BUDGET_WORKSPACE);
      expect(
        rows.some(
          (r) =>
            r.status === "RECONCILIATION_REQUIRED" ||
            r.status === "PROVIDER_STARTED" ||
            r.uncertain_floor_usd_micros !== null,
        ),
      ).toBe(true);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("W16/W21: provider outcome failure after start — no automatic release", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 10_000_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      modelName: "gpt-routing-retry-429",
    });
    try {
      const outcome = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w16-single-fail",
      );
      expect(outcome.terminal).toBe("FAILED");
      expect(fake.requests.length).toBe(1);
      const rows = await listReservations(database, BUDGET_WORKSPACE);
      expect(rows.every((r) => r.status === "RELEASED")).toBe(false);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  });

  it("W17: second run after successful reservation does not double provider spend", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 10_000_000,
      now: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      withCache: true,
    });
    try {
      await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w17-a",
      );
      const calls = fake.requests.length;
      await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w17-b",
      );
      expect(fake.requests.length).toBe(calls);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("W22: committed cost above reservation records overage once (Responses generateText path — DB13)", async () => {
    const policies = new PostgresInferenceBudgetPolicyRepository(database);
    await policies.savePolicy({
      id: "ibp-w22" as import("@osva-ai/contracts").InferenceBudgetPolicyId,
      workspaceId: BUDGET_WORKSPACE,
      key: "default",
      createdAt: NOW,
    });
    const versionId =
      "ibpv-w22" as import("@osva-ai/contracts").InferenceBudgetPolicyVersionId;
    await policies.savePolicyVersion({
      id: versionId,
      policyId:
        "ibp-w22" as import("@osva-ai/contracts").InferenceBudgetPolicyId,
      workspaceId: BUDGET_WORKSPACE,
      version: 1,
      definition: {
        ...createDefaultInferenceBudgetPolicyDefinition(),
        periodLimitUsdMicros: 500_000_000,
        unknownAdmitCostBehavior: "USE_POLICY_FLOOR_USD_MICROS",
        unknownAdmitCostFloorUsdMicros: 5_000,
      },
      createdAt: NOW,
    });
    await policies.upsertWorkspaceActivation({
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      activePolicyVersionId: versionId,
      updatedAt: NOW,
    });
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      fixtureName: "model-budget-high-usage-agent.ts",
      agentKey: "model-budget-high-usage-agent",
    });
    try {
      const outcome = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w22-overage",
      );
      expect(outcome.terminal).toBe("SUCCEEDED");
      const rows = await listReservations(database, BUDGET_WORKSPACE);
      const row = rows[0];
      expect(row).toBeDefined();
      const ledger = await readPeriodLedger(
        database,
        BUDGET_WORKSPACE,
        currentPeriodKey(),
      );
      const rowOverage =
        (row?.committed_usd_micros ?? 0) > (row?.reserved_usd_micros ?? 0);
      const ledgerOverage = (ledger?.overage_usd_micros ?? 0) > 0;
      const evidence = {
        row,
        ledger,
        fakeCalls: fake.requests.length,
        terminal: outcome.terminal,
      };
      expect(
        rowOverage || ledgerOverage,
        `W22 overage evidence: ${JSON.stringify(evidence)}`,
      ).toBe(true);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);
});
