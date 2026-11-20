/**
 * B5.5C.2 — Activation safety gate (W18–W20 worker harness).
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
  vi,
} from "vitest";
import {
  createDatabase,
  migrateDatabase,
  PostgresRunRepository,
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
  BUDGET_WORKSPACE,
  createBudgetWorkerStack,
  createRun,
  listReservations,
  readPeriodLedger,
  seedInferenceBudgetPolicy,
  waitForRunTerminal,
  waitUntil,
  periodKeyFor,
  runAgentOnce,
} from "./inference-budget-worker-harness.js";

const NOW = new Date("2026-02-15T12:00:00.000Z");

function sumReservedMicros(
  rows: Awaited<ReturnType<typeof listReservations>>,
): number {
  return rows.reduce((sum, row) => sum + row.reserved_usd_micros, 0);
}

describe("B5.5C.2 inference budget activation safety", () => {
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
    vi.restoreAllMocks();
    await redis.flushdb();
  });

  it("W18: queue redelivery after provider start — no duplicate hold or provider I/O", async () => {
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
      const { runId, runAttemptId } = await createRun(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w18-redelivery",
      );
      const terminal = await waitForRunTerminal(stack.origin, runId);
      expect(terminal).toBe("FAILED");
      const providerCallsBefore = fake.requests.length;
      expect(providerCallsBefore).toBe(1);
      const before = await listReservations(database, BUDGET_WORKSPACE);
      expect(before.length).toBeGreaterThan(0);
      const reservationKey = before[0]?.reservation_key;
      const ledgerBefore = await readPeriodLedger(
        database,
        BUDGET_WORKSPACE,
        periodKeyFor(NOW),
      );

      await stack.inspector.enqueue(runAttemptId);
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      expect(fake.requests.length).toBe(providerCallsBefore);
      const after = await listReservations(database, BUDGET_WORKSPACE);
      expect(after.length).toBe(before.length);
      expect(after[0]?.reservation_key).toBe(reservationKey);
      expect(sumReservedMicros(after)).toBe(sumReservedMicros(before));
      const ledgerAfter = await readPeriodLedger(
        database,
        BUDGET_WORKSPACE,
        periodKeyFor(NOW),
      );
      expect(ledgerAfter?.held_reservations_usd_micros).toBe(
        ledgerBefore?.held_reservations_usd_micros,
      );
      expect(
        after.some(
          (row) =>
            row.status === "PROVIDER_STARTED" ||
            row.status === "RECONCILIATION_REQUIRED" ||
            row.uncertain_floor_usd_micros !== null,
        ),
      ).toBe(true);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("W19: execution generation fence blocks stale provider start", async () => {
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
      fixtureName: "model-budget-hang-agent.ts",
      agentKey: "model-budget-hang-agent",
    });
    try {
      const { runId, runAttemptId } = await createRun(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "w19-fence",
      );

      await waitUntil(async () => {
        const rows = await listReservations(database, BUDGET_WORKSPACE);
        return (
          fake.requests.length === 1 &&
          rows.some((r) => r.status === "PROVIDER_STARTED")
        );
      });

      await database.sql.unsafe(
        `UPDATE run_attempts
         SET execution_generation = 2,
             execution_owner = NULL,
             lease_expires_at = NOW() - INTERVAL '1 minute'
         WHERE id = $1`,
        [runAttemptId],
      );

      await stack.inspector.enqueue(runAttemptId);
      await new Promise((resolve) => setTimeout(resolve, 3_000));

      expect(fake.requests.length).toBe(1);
      const rows = await listReservations(database, BUDGET_WORKSPACE);
      expect(rows.some((r) => r.status === "PROVIDER_STARTED")).toBe(true);
      void runId;
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 120_000);

  it("W20: RunStep finalize failure does not erase budget settlement", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 10_000_000,
      now: NOW,
    });
    const originalFinalize = PostgresRunRepository.prototype.finalizeRunStep;
    vi.spyOn(
      PostgresRunRepository.prototype,
      "finalizeRunStep",
    ).mockImplementation(
      function finalizeRunStepWithInjection(runStepId, finalize) {
        if (finalize.status === "SUCCEEDED") {
          throw new Error("injected run step finalize failure");
        }
        return originalFinalize.call(this, runStepId, finalize);
      },
    );

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
        "w20-finalize-fail",
      );
      expect(["SUCCEEDED", "FAILED"]).toContain(outcome.terminal);
      expect(fake.requests.length).toBe(1);
      const rows = await listReservations(database, BUDGET_WORKSPACE);
      expect(rows.length).toBeGreaterThan(0);
      const row = rows[0];
      expect(row?.status).not.toBe("RELEASED");
      const liabilityCommitted = (row?.committed_usd_micros ?? 0) > 0;
      const liabilityUncertain =
        row?.status === "PROVIDER_STARTED" ||
        row?.status === "RECONCILIATION_REQUIRED" ||
        row?.status === "COMMITTED" ||
        (row?.uncertain_floor_usd_micros ?? 0) > 0;
      expect(liabilityCommitted || liabilityUncertain).toBe(true);
      const ledger = await readPeriodLedger(
        database,
        BUDGET_WORKSPACE,
        periodKeyFor(NOW),
      );
      if (ledger !== null) {
        const ledgerRetainsLiability =
          (ledger.committed_liability_usd_micros ?? 0) > 0 ||
          (ledger.held_reservations_usd_micros ?? 0) > 0 ||
          (ledger.unresolved_uncertain_liability_usd_micros ?? 0) > 0;
        expect(ledgerRetainsLiability || liabilityCommitted).toBe(true);
      }
      if (liabilityCommitted) {
        expect(row?.status).toBe("COMMITTED");
        expect(
          (ledger?.committed_liability_usd_micros ?? 0) >=
            (row?.committed_usd_micros ?? 0),
        ).toBe(true);
      }
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);
});
