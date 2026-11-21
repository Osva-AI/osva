/**
 * B5.5C.3 — Controlled inference budget activation (worker ACT12–ACT16).
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
import {
  createDatabase,
  migrateDatabase,
  PostgresInferenceBudgetPolicyRepository,
  type Database,
} from "@osva/db";
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
import { bootstrapIntegrationAuth } from "./integration-auth.js";
import {
  BUDGET_POLICY_VERSION_ID,
  BUDGET_WORKSPACE,
  activateInferenceBudgetPolicyViaApi,
  activateRoutingPolicy,
  createBudgetWorkerStack,
  disableInferenceBudgetPolicyViaApi,
  listReservations,
  runAgentOnce,
  seedInferenceBudgetPolicy,
} from "./inference-budget-worker-harness.js";

const NOW = new Date("2026-02-15T12:00:00.000Z");

describe("B5.5C.3 inference budget activation worker propagation", () => {
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
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: false,
      periodLimitUsdMicros: 2_000_000,
      now: NOW,
    });
  });

  afterEach(async () => {
    await redis.flushall();
  });

  it("ACT12–ACT16: API activation without worker restart; disable preserves ledger", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    let stack: Awaited<ReturnType<typeof createBudgetWorkerStack>> | undefined;
    try {
      stack = await createBudgetWorkerStack({
        postgres,
        valkey,
        fakeOrigin: fake.origin,
        activationApiEnabled: true,
      });

      await activateRoutingPolicy(stack.origin, {
        key: "budget-routing",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [stack.modelProfileVersionId],
          allowFallback: false,
          maxProviderAttempts: 1,
        },
      });

      await activateInferenceBudgetPolicyViaApi(
        stack.origin,
        BUDGET_POLICY_VERSION_ID,
      );

      const policies = new PostgresInferenceBudgetPolicyRepository(database);
      const runtimeBefore =
        await policies.findRuntimePolicyByWorkspaceId(BUDGET_WORKSPACE);
      expect(runtimeBefore?.enabled).toBe(true);

      const { terminal } = await runAgentOnce(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "activation-api-run",
      );
      expect(terminal).toBe("SUCCEEDED");
      expect(
        (await listReservations(database, BUDGET_WORKSPACE)).length,
      ).toBeGreaterThan(0);

      const reservationsBeforeDisable = await listReservations(
        database,
        BUDGET_WORKSPACE,
      );
      const committedBeforeDisable = reservationsBeforeDisable.reduce(
        (sum, row) => sum + (row.committed_usd_micros ?? 0),
        0,
      );

      await disableInferenceBudgetPolicyViaApi(stack.origin);
      const runtimeAfterDisable =
        await policies.findRuntimePolicyByWorkspaceId(BUDGET_WORKSPACE);
      expect(runtimeAfterDisable?.enabled).toBe(false);
      const activationAfterDisable =
        await policies.findWorkspaceActivation(BUDGET_WORKSPACE);
      expect(activationAfterDisable?.enabled).toBe(false);

      const reservationsAfterDisable = await listReservations(
        database,
        BUDGET_WORKSPACE,
      );
      expect(reservationsAfterDisable.length).toBe(
        reservationsBeforeDisable.length,
      );
      const committedAfterDisable = reservationsAfterDisable.reduce(
        (sum, row) => sum + (row.committed_usd_micros ?? 0),
        0,
      );
      expect(committedAfterDisable).toBe(committedBeforeDisable);

      await activateInferenceBudgetPolicyViaApi(
        stack.origin,
        BUDGET_POLICY_VERSION_ID,
      );
      const activationAfterReEnable =
        await policies.findWorkspaceActivation(BUDGET_WORKSPACE);
      expect(activationAfterReEnable?.enabled).toBe(true);
      expect(activationAfterReEnable?.activePolicyVersionId).toBe(
        BUDGET_POLICY_VERSION_ID,
      );
    } finally {
      await stack?.shutdown();
      await fake.close();
    }
  });
});
