import {
  INFERENCE_BUDGET_ERROR_CODES,
  INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
  type InferenceBudgetPeriodKeyV1,
  type InferenceBudgetPolicyId,
  type InferenceBudgetPolicyVersionId,
  type InferenceBudgetReservationKeyV1,
  type InferenceInvocationId,
  type ModelProfileVersionId,
  type RunAttemptId,
  type WorkspaceId,
} from "@osva-ai/contracts";
import {
  Workspace,
  buildInferenceInvocationAnchorString,
  deriveInferenceBudgetReservationKey,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  migrateDatabase,
  PostgresInferenceBudgetAdmissionRepository,
  PostgresInferenceBudgetPolicyRepository,
  PostgresWorkspaceRepository,
  verifyMigrationHistory,
  type Database,
} from "../../src/index.js";
import { workspaceInferenceBudgetPeriods } from "../../src/schema/workspace-inference-budget-periods.js";
import { inferenceBudgetReservations } from "../../src/schema/inference-budget-reservations.js";
import { eq } from "drizzle-orm";

import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";
import { postgresErrorCode } from "../../src/postgres-errors.js";

const POSTGRES_DEADLOCK_SQLSTATE = "40P01";
const CONCURRENCY_DEADLINE_MS = 15_000;

function expectNotPostgresDeadlock(error: unknown): void {
  expect(postgresErrorCode(error)).not.toBe(POSTGRES_DEADLOCK_SQLSTATE);
}

async function runWithoutDeadlock<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    expectNotPostgresDeadlock(error);
    throw error;
  }
}

const WORKSPACE_A = "ws-budget-a" as WorkspaceId;
const WORKSPACE_B = "ws-budget-b" as WorkspaceId;
const POLICY_ID = "ibp-test" as InferenceBudgetPolicyId;
const POLICY_VERSION_ID = "ibpv-test" as InferenceBudgetPolicyVersionId;
const PROFILE_V1 = "mpv-budget-test" as ModelProfileVersionId;
const RUN_ATTEMPT = "rat-budget-test" as RunAttemptId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const DEFAULT_PERIOD_LIMIT_USD_MICROS = 1_000_000;

function agentAnchor(ordinal: number) {
  return {
    anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
    workspaceId: WORKSPACE_A,
    invocationKind: "SYNC" as const,
    material: {
      scope: "AGENT_RUN" as const,
      runAttemptId: RUN_ATTEMPT,
      executionGeneration: 1,
      bindingName: "main",
      modelInvocationOrdinal: ordinal,
    },
  };
}

describe("inference budget PostgreSQL authority (0044)", () => {
  let postgres: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let policies: PostgresInferenceBudgetPolicyRepository;
  let budget: PostgresInferenceBudgetAdmissionRepository;
  const activePolicyVersionIdByWorkspace = new Map<
    WorkspaceId,
    InferenceBudgetPolicyVersionId
  >();

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 6,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    policies = new PostgresInferenceBudgetPolicyRepository(database);
    budget = new PostgresInferenceBudgetAdmissionRepository(database);
  });

  beforeEach(async () => {
    activePolicyVersionIdByWorkspace.clear();
    await resetStage0Tables(database);
    for (const [id, name] of [
      [WORKSPACE_A, "Budget A"],
      [WORKSPACE_B, "Budget B"],
    ] as const) {
      await workspaces.save(Workspace.create({ id, name, createdAt: NOW }));
      await seedPolicyVersion(id, DEFAULT_PERIOD_LIMIT_USD_MICROS);
      activePolicyVersionIdByWorkspace.set(
        id,
        `${POLICY_VERSION_ID}-${id}` as InferenceBudgetPolicyVersionId,
      );
    }
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
  });

  function policyVersionIdForWorkspace(
    workspaceId: WorkspaceId,
    versionToken: string,
  ): InferenceBudgetPolicyVersionId {
    if (versionToken.length === 0) {
      return `${POLICY_VERSION_ID}-${workspaceId}` as InferenceBudgetPolicyVersionId;
    }
    return `${POLICY_VERSION_ID}-${versionToken}-${workspaceId}` as InferenceBudgetPolicyVersionId;
  }

  function activePolicyVersionId(
    workspaceId: WorkspaceId,
  ): InferenceBudgetPolicyVersionId {
    return (
      activePolicyVersionIdByWorkspace.get(workspaceId) ??
      (`${POLICY_VERSION_ID}-${workspaceId}` as InferenceBudgetPolicyVersionId)
    );
  }

  async function seedPolicyVersion(
    workspaceId: WorkspaceId,
    limitUsdMicros: number,
    options?: { versionToken?: string; versionNumber?: number },
  ) {
    const policyId = `${POLICY_ID}-${workspaceId}` as InferenceBudgetPolicyId;
    const versionToken = options?.versionToken ?? "";
    const versionNumber = options?.versionNumber ?? 1;
    const versionId = policyVersionIdForWorkspace(workspaceId, versionToken);

    const existingPolicy = await policies.findPolicyById(workspaceId, policyId);
    if (existingPolicy === null) {
      await policies.savePolicy({
        id: policyId,
        workspaceId,
        key: "default",
        createdAt: NOW,
      });
    }

    await policies.savePolicyVersion({
      id: versionId,
      policyId,
      workspaceId,
      version: versionNumber,
      definition: {
        schemaVersion: "1",
        periodKind: "CALENDAR_MONTH_UTC",
        periodLimitUsdMicros: limitUsdMicros,
        periodEnforcement: "STRICT_PERIOD_CAP",
        unknownAdmitCostBehavior: "DENY_ADMISSION",
        onLeaseLoss: "RECONCILIATION_REQUIRED",
      },
      createdAt: NOW,
    });
    return versionId;
  }

  async function enableBudget(
    workspaceId: WorkspaceId,
    limitUsdMicros: number,
    enabled = true,
  ) {
    let activeVersionId = activePolicyVersionId(workspaceId);
    if (limitUsdMicros !== DEFAULT_PERIOD_LIMIT_USD_MICROS) {
      const token = `lim${limitUsdMicros}`;
      activeVersionId = await seedPolicyVersion(workspaceId, limitUsdMicros, {
        versionToken: token,
        versionNumber: 2,
      });
    }
    activePolicyVersionIdByWorkspace.set(workspaceId, activeVersionId);
    await policies.upsertWorkspaceActivation({
      workspaceId,
      enabled,
      activePolicyVersionId: activeVersionId,
      updatedAt: NOW,
    });
  }

  async function allocateInvocation(
    workspaceId: WorkspaceId,
    ordinal: number,
  ): Promise<InferenceInvocationId> {
    const anchor = agentAnchor(ordinal);
    const invocation = await budget.allocateInvocation({
      workspaceId,
      anchor,
      periodKey: "2026-01" as InferenceBudgetPeriodKeyV1,
      budgetPolicyVersionId: activePolicyVersionId(workspaceId),
      pricingSnapshotId: "pricing-v1",
      runAttemptId: RUN_ATTEMPT,
    });
    return invocation.id;
  }

  function reservationKey(
    invocationId: InferenceInvocationId,
    attemptIndex = 0,
  ): InferenceBudgetReservationKeyV1 {
    return deriveInferenceBudgetReservationKey({
      version: "1",
      inferenceInvocationId: invocationId,
      providerAttemptIndex: attemptIndex,
      selectedModelProfileVersionId: PROFILE_V1,
    });
  }

  async function admit(
    workspaceId: WorkspaceId,
    invocationId: InferenceInvocationId,
    ceiling: number,
    attemptIndex = 0,
  ) {
    const key = reservationKey(invocationId, attemptIndex);
    const anchor = buildInferenceInvocationAnchorString(agentAnchor(1));
    return budget.admitOrGetExisting({
      workspaceId,
      reservationKey: key,
      admitCeilingUsdMicros: ceiling,
      attempt: {
        workspaceId,
        inferenceInvocationId: invocationId,
        invocationAnchor: anchor,
        periodKey: "2026-01" as InferenceBudgetPeriodKeyV1,
        budgetPolicyVersionId: activePolicyVersionId(workspaceId),
        pricingSnapshotId: "pricing-v1",
        providerAttemptIndex: attemptIndex,
        selectedModelProfileVersionId: PROFILE_V1,
        admitCeilingUsdMicros: ceiling,
        runAttemptId: RUN_ATTEMPT,
      },
    });
  }

  it("DB1: migration integrity and fresh installation", async () => {
    const verification = verifyMigrationHistory();
    expect(verification.ok).toBe(true);
    const tables = await database.sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'workspace_inference_budget_policies',
          'workspace_inference_budget_policy_versions',
          'workspace_inference_budget_activation',
          'workspace_inference_budget_periods',
          'inference_invocations',
          'inference_budget_reservations'
        )
      ORDER BY table_name
    `;
    expect(tables.map((row) => row.table_name)).toEqual([
      "inference_budget_reservations",
      "inference_invocations",
      "workspace_inference_budget_activation",
      "workspace_inference_budget_periods",
      "workspace_inference_budget_policies",
      "workspace_inference_budget_policy_versions",
    ]);

    const activationDefault = await database.sql`
      SELECT column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'workspace_inference_budget_activation'
        AND column_name = 'enabled'
    `;
    expect(activationDefault[0]?.column_default).toMatch(/false/i);

    const criticalUniques = await database.sql`
      SELECT tc.table_name, tc.constraint_name
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type = 'UNIQUE'
        AND tc.constraint_name IN (
          'inference_budget_reservations_workspace_key_unique',
          'inference_invocations_workspace_anchor_unique',
          'workspace_inference_budget_periods_workspace_period_unique',
          'workspace_inference_budget_policies_workspace_key_unique',
          'workspace_inference_budget_policy_versions_policy_version_unique'
        )
      ORDER BY tc.table_name, tc.constraint_name
    `;
    expect(criticalUniques).toHaveLength(5);

    const reservationChecks = await database.sql`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.inference_budget_reservations'::regclass
        AND contype = 'c'
      ORDER BY conname
    `;
    expect(reservationChecks.map((row) => row.conname)).toEqual([
      "inference_budget_reservations_provider_attempt_index_check",
      "inference_budget_reservations_reserved_nonneg_check",
      "inference_budget_reservations_status_check",
    ]);
  });

  it("DB2: budget disabled, no reservation allocation", async () => {
    await policies.upsertWorkspaceActivation({
      workspaceId: WORKSPACE_A,
      enabled: false,
      updatedAt: NOW,
    });
    const invocation = await allocateInvocation(WORKSPACE_A, 1);
    const outcome = await admit(WORKSPACE_A, invocation, 500_000);
    expect(outcome.outcome).toBe("BYPASSED");
    const rows = await database.db.select().from(inferenceBudgetReservations);
    expect(rows).toHaveLength(0);
  });

  it("DB3: admission under configured limit", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const invocation = await allocateInvocation(WORKSPACE_A, 1);
    const outcome = await admit(WORKSPACE_A, invocation, 400_000);
    expect(outcome.outcome).toBe("ADMITTED");
  });

  it("DB4: admission exactly at limit", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const invocation = await allocateInvocation(WORKSPACE_A, 1);
    const outcome = await admit(WORKSPACE_A, invocation, 1_000_000);
    expect(outcome.outcome).toBe("ADMITTED");
  });

  it("DB5: admission exceeding remaining capacity", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const inv1 = await allocateInvocation(WORKSPACE_A, 1);
    await admit(WORKSPACE_A, inv1, 700_000);
    const inv2 = await allocateInvocation(WORKSPACE_A, 2);
    const denied = await admit(WORKSPACE_A, inv2, 400_000);
    expect(denied).toEqual({
      outcome: "DENIED",
      errorCode: INFERENCE_BUDGET_ERROR_CODES.MODEL_INFERENCE_BUDGET_EXCEEDED,
      retryable: false,
    });
  });

  it("DB6: concurrent workers — distinct keys, $1.00 limit, two $0.60 admits", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const inv1 = await allocateInvocation(WORKSPACE_A, 1);
    const inv2 = await allocateInvocation(WORKSPACE_A, 2);

    const connA = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });
    const connB = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });
    const budgetA = new PostgresInferenceBudgetAdmissionRepository(connA);
    const budgetB = new PostgresInferenceBudgetAdmissionRepository(connB);

    const [left, right] = await Promise.all([
      budgetA.admitOrGetExisting({
        workspaceId: WORKSPACE_A,
        reservationKey: reservationKey(inv1),
        admitCeilingUsdMicros: 600_000,
        attempt: {
          workspaceId: WORKSPACE_A,
          inferenceInvocationId: inv1,
          invocationAnchor: buildInferenceInvocationAnchorString(
            agentAnchor(1),
          ),
          periodKey: "2026-01" as InferenceBudgetPeriodKeyV1,
          budgetPolicyVersionId: activePolicyVersionId(WORKSPACE_A),
          pricingSnapshotId: "pricing-v1",
          providerAttemptIndex: 0,
          selectedModelProfileVersionId: PROFILE_V1,
          admitCeilingUsdMicros: 600_000,
          runAttemptId: RUN_ATTEMPT,
        },
      }),
      budgetB.admitOrGetExisting({
        workspaceId: WORKSPACE_A,
        reservationKey: reservationKey(inv2),
        admitCeilingUsdMicros: 600_000,
        attempt: {
          workspaceId: WORKSPACE_A,
          inferenceInvocationId: inv2,
          invocationAnchor: buildInferenceInvocationAnchorString(
            agentAnchor(2),
          ),
          periodKey: "2026-01" as InferenceBudgetPeriodKeyV1,
          budgetPolicyVersionId: activePolicyVersionId(WORKSPACE_A),
          pricingSnapshotId: "pricing-v1",
          providerAttemptIndex: 0,
          selectedModelProfileVersionId: PROFILE_V1,
          admitCeilingUsdMicros: 600_000,
          runAttemptId: RUN_ATTEMPT,
        },
      }),
    ]);

    expect([left.outcome, right.outcome].sort()).toEqual(
      ["ADMITTED", "DENIED"].sort(),
    );

    const reservations = await database.db
      .select()
      .from(inferenceBudgetReservations)
      .where(eq(inferenceBudgetReservations.workspaceId, WORKSPACE_A));
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.reservedUsdMicros).toBe(600_000);

    const [period] = await database.db
      .select()
      .from(workspaceInferenceBudgetPeriods)
      .where(eq(workspaceInferenceBudgetPeriods.workspaceId, WORKSPACE_A));
    expect(period?.heldReservationsUsdMicros).toBe(600_000);

    await connA.close();
    await connB.close();
  });

  it("DB6b: concurrent same reservation key — one row, single held increment", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const invocation = await allocateInvocation(WORKSPACE_A, 1);
    const key = reservationKey(invocation);
    const attempt = {
      workspaceId: WORKSPACE_A,
      inferenceInvocationId: invocation,
      invocationAnchor: buildInferenceInvocationAnchorString(agentAnchor(1)),
      periodKey: "2026-01" as InferenceBudgetPeriodKeyV1,
      budgetPolicyVersionId: activePolicyVersionId(WORKSPACE_A),
      pricingSnapshotId: "pricing-v1",
      providerAttemptIndex: 0,
      selectedModelProfileVersionId: PROFILE_V1,
      admitCeilingUsdMicros: 600_000,
      runAttemptId: RUN_ATTEMPT,
    };

    const connA = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });
    const connB = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });
    const budgetA = new PostgresInferenceBudgetAdmissionRepository(connA);
    const budgetB = new PostgresInferenceBudgetAdmissionRepository(connB);

    const [left, right] = await Promise.all([
      budgetA.admitOrGetExisting({
        workspaceId: WORKSPACE_A,
        reservationKey: key,
        admitCeilingUsdMicros: 600_000,
        attempt,
      }),
      budgetB.admitOrGetExisting({
        workspaceId: WORKSPACE_A,
        reservationKey: key,
        admitCeilingUsdMicros: 600_000,
        attempt,
      }),
    ]);

    expect([left.outcome, right.outcome].sort()).toEqual(
      ["ADMITTED", "IDEMPOTENT_EXISTING"].sort(),
    );

    const reservations = await database.db
      .select()
      .from(inferenceBudgetReservations)
      .where(eq(inferenceBudgetReservations.workspaceId, WORKSPACE_A));
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.reservationKey).toBe(key);

    const [period] = await database.db
      .select()
      .from(workspaceInferenceBudgetPeriods)
      .where(eq(workspaceInferenceBudgetPeriods.workspaceId, WORKSPACE_A));
    expect(period?.heldReservationsUsdMicros).toBe(600_000);

    await connA.close();
    await connB.close();
  });

  it("DB6c: concurrent reconciliation and same-key admission — no deadlock (40P01)", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const invocation = await allocateInvocation(WORKSPACE_A, 1);
    const key = reservationKey(invocation);
    const admitted = await admit(WORKSPACE_A, invocation, 350_000);
    if (admitted.outcome !== "ADMITTED") {
      throw new Error("expected admitted reservation");
    }
    await budget.markProviderStarted({
      workspaceId: WORKSPACE_A,
      reservationId: admitted.reservation.id,
    });

    const inv2 = await allocateInvocation(WORKSPACE_A, 2);
    const attemptSameKey = {
      workspaceId: WORKSPACE_A,
      inferenceInvocationId: invocation,
      invocationAnchor: buildInferenceInvocationAnchorString(agentAnchor(1)),
      periodKey: "2026-01" as InferenceBudgetPeriodKeyV1,
      budgetPolicyVersionId: activePolicyVersionId(WORKSPACE_A),
      pricingSnapshotId: "pricing-v1",
      providerAttemptIndex: 0,
      selectedModelProfileVersionId: PROFILE_V1,
      admitCeilingUsdMicros: 350_000,
      runAttemptId: RUN_ATTEMPT,
    };
    const reconcileInput = {
      workspaceId: WORKSPACE_A,
      reservation: {
        ...admitted.reservation,
        status: "PROVIDER_STARTED" as const,
      },
      periodLedger: admitted.periodLedgerAfter,
      committedUsdMicros: 200_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    };

    const connA = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });
    const connB = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });
    const connC = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });
    const budgetA = new PostgresInferenceBudgetAdmissionRepository(connA);
    const budgetB = new PostgresInferenceBudgetAdmissionRepository(connB);
    const budgetC = new PostgresInferenceBudgetAdmissionRepository(connC);

    const overlapWork = Promise.all([
      runWithoutDeadlock(() => budgetA.reconcile(reconcileInput)),
      runWithoutDeadlock(() =>
        budgetB.admitOrGetExisting({
          workspaceId: WORKSPACE_A,
          reservationKey: key,
          admitCeilingUsdMicros: 350_000,
          attempt: attemptSameKey,
        }),
      ),
      runWithoutDeadlock(() =>
        budgetC.admitOrGetExisting({
          workspaceId: WORKSPACE_A,
          reservationKey: reservationKey(inv2),
          admitCeilingUsdMicros: 250_000,
          attempt: {
            workspaceId: WORKSPACE_A,
            inferenceInvocationId: inv2,
            invocationAnchor: buildInferenceInvocationAnchorString(
              agentAnchor(2),
            ),
            periodKey: "2026-01" as InferenceBudgetPeriodKeyV1,
            budgetPolicyVersionId: activePolicyVersionId(WORKSPACE_A),
            pricingSnapshotId: "pricing-v1",
            providerAttemptIndex: 0,
            selectedModelProfileVersionId: PROFILE_V1,
            admitCeilingUsdMicros: 250_000,
            runAttemptId: RUN_ATTEMPT,
          },
        }),
      ),
    ]);

    const results = await Promise.race([
      overlapWork,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("DB6c concurrency deadline exceeded")),
          CONCURRENCY_DEADLINE_MS,
        );
      }),
    ]);

    expect(results[0].nextStatus).toBe("COMMITTED");
    expect(results[1].outcome).toBe("IDEMPOTENT_EXISTING");
    expect(
      results[2].outcome === "ADMITTED" ||
        results[2].outcome === "IDEMPOTENT_EXISTING" ||
        results[2].outcome === "DENIED",
    ).toBe(true);

    const [period] = await database.db
      .select()
      .from(workspaceInferenceBudgetPeriods)
      .where(eq(workspaceInferenceBudgetPeriods.workspaceId, WORKSPACE_A));
    expect(period?.committedLiabilityUsdMicros).toBe(200_000);

    await connA.close();
    await connB.close();
    await connC.close();
  });

  it("DB7: concurrent creation of first period row", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const inv1 = await allocateInvocation(WORKSPACE_A, 1);
    const inv2 = await allocateInvocation(WORKSPACE_A, 2);

    const [a, b] = await Promise.all([
      admit(WORKSPACE_A, inv1, 100_000),
      admit(WORKSPACE_A, inv2, 100_000),
    ]);
    expect(
      a.outcome === "ADMITTED" || a.outcome === "IDEMPOTENT_EXISTING",
    ).toBe(true);
    expect(
      b.outcome === "ADMITTED" || b.outcome === "IDEMPOTENT_EXISTING",
    ).toBe(true);

    const periods = await database.db
      .select()
      .from(workspaceInferenceBudgetPeriods)
      .where(eq(workspaceInferenceBudgetPeriods.workspaceId, WORKSPACE_A));
    expect(periods).toHaveLength(1);
  });

  it("DB8: same invocation anchor returns same identity", async () => {
    const first = await allocateInvocation(WORKSPACE_A, 3);
    const second = await allocateInvocation(WORKSPACE_A, 3);
    expect(second).toEqual(first);
  });

  it("DB9: same reservation key does not double-reserve", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const invocation = await allocateInvocation(WORKSPACE_A, 4);
    const first = await admit(WORKSPACE_A, invocation, 300_000);
    const second = await admit(WORKSPACE_A, invocation, 300_000);
    expect(first.outcome).toBe("ADMITTED");
    expect(second.outcome).toBe("IDEMPOTENT_EXISTING");

    const rows = await database.db
      .select()
      .from(inferenceBudgetReservations)
      .where(eq(inferenceBudgetReservations.workspaceId, WORKSPACE_A));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reservedUsdMicros).toBe(300_000);
  });

  it("DB10: different invocation creates separate hold", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const inv1 = await allocateInvocation(WORKSPACE_A, 5);
    const inv2 = await allocateInvocation(WORKSPACE_A, 6);
    await admit(WORKSPACE_A, inv1, 100_000);
    await admit(WORKSPACE_A, inv2, 200_000);
    const rows = await database.db
      .select()
      .from(inferenceBudgetReservations)
      .where(eq(inferenceBudgetReservations.workspaceId, WORKSPACE_A));
    expect(rows).toHaveLength(2);
  });

  it("DB11: successful reconciliation and partial refund", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const invocation = await allocateInvocation(WORKSPACE_A, 7);
    const admitted = await admit(WORKSPACE_A, invocation, 500_000);
    if (admitted.outcome !== "ADMITTED") {
      throw new Error("Expected admission");
    }
    await budget.markProviderStarted({
      workspaceId: WORKSPACE_A,
      reservationId: admitted.reservation.id,
    });
    const reconciled = await budget.reconcile({
      workspaceId: WORKSPACE_A,
      reservation: { ...admitted.reservation, status: "PROVIDER_STARTED" },
      periodLedger: admitted.periodLedgerAfter,
      committedUsdMicros: 200_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    expect(reconciled.nextStatus).toBe("COMMITTED");
    expect(reconciled.periodLedgerAfter.heldReservationsUsdMicros).toBe(0);
    expect(reconciled.periodLedgerAfter.committedLiabilityUsdMicros).toBe(
      200_000,
    );
  });

  it("DB12: idempotent repeated reconciliation", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const invocation = await allocateInvocation(WORKSPACE_A, 8);
    const admitted = await admit(WORKSPACE_A, invocation, 400_000);
    if (admitted.outcome !== "ADMITTED") {
      throw new Error("Expected admission");
    }
    await budget.markProviderStarted({
      workspaceId: WORKSPACE_A,
      reservationId: admitted.reservation.id,
    });
    const first = await budget.reconcile({
      workspaceId: WORKSPACE_A,
      reservation: { ...admitted.reservation, status: "PROVIDER_STARTED" },
      periodLedger: admitted.periodLedgerAfter,
      committedUsdMicros: 250_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    const second = await budget.reconcile({
      workspaceId: WORKSPACE_A,
      reservation: first.reservationAfter,
      periodLedger: first.periodLedgerAfter,
      committedUsdMicros: 250_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    expect(second.periodDelta).toEqual({
      committedLiabilityUsdMicros: 0,
      heldReservationsUsdMicros: 0,
      unresolvedUncertainLiabilityUsdMicros: 0,
      overageUsdMicros: 0,
    });
  });

  it("DB13: actual > reserved records full liability and overage", async () => {
    await enableBudget(WORKSPACE_A, 2_000_000);
    const invocation = await allocateInvocation(WORKSPACE_A, 9);
    const admitted = await admit(WORKSPACE_A, invocation, 100_000);
    if (admitted.outcome !== "ADMITTED") throw new Error("admit");
    await budget.markProviderStarted({
      workspaceId: WORKSPACE_A,
      reservationId: admitted.reservation.id,
    });
    const outcome = await budget.reconcile({
      workspaceId: WORKSPACE_A,
      reservation: { ...admitted.reservation, status: "PROVIDER_STARTED" },
      periodLedger: admitted.periodLedgerAfter,
      committedUsdMicros: 150_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    expect(outcome.periodLedgerAfter.committedLiabilityUsdMicros).toBe(150_000);
    expect(outcome.periodLedgerAfter.overageUsdMicros).toBe(50_000);
  });

  it("DB14: unknown actual remains uncertain", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const invocation = await allocateInvocation(WORKSPACE_A, 10);
    const admitted = await admit(WORKSPACE_A, invocation, 250_000);
    if (admitted.outcome !== "ADMITTED") throw new Error("admit");
    await budget.markProviderStarted({
      workspaceId: WORKSPACE_A,
      reservationId: admitted.reservation.id,
    });
    const outcome = await budget.reconcile({
      workspaceId: WORKSPACE_A,
      reservation: { ...admitted.reservation, status: "PROVIDER_STARTED" },
      periodLedger: admitted.periodLedgerAfter,
      committedUsdMicros: null,
      usageKnown: false,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    expect(outcome.nextStatus).toBe("RECONCILIATION_REQUIRED");
    expect(outcome.committedUsdMicros).toBeNull();
    expect(
      outcome.periodLedgerAfter.unresolvedUncertainLiabilityUsdMicros,
    ).toBeGreaterThan(0);
  });

  it("DB15: uncertain provider acceptance cannot auto-release", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const invocation = await allocateInvocation(WORKSPACE_A, 11);
    const admitted = await admit(WORKSPACE_A, invocation, 180_000);
    if (admitted.outcome !== "ADMITTED") throw new Error("admit");
    await budget.markProviderStarted({
      workspaceId: WORKSPACE_A,
      reservationId: admitted.reservation.id,
    });
    const uncertain = await budget.markReconciliationRequired({
      workspaceId: WORKSPACE_A,
      reservation: { ...admitted.reservation, status: "PROVIDER_STARTED" },
      periodLedger: admitted.periodLedgerAfter,
    });
    expect(uncertain.reservationAfter.status).toBe("RECONCILIATION_REQUIRED");
    expect(
      uncertain.periodLedgerAfter.unresolvedUncertainLiabilityUsdMicros,
    ).toBeGreaterThan(0);
  });

  it("DB16: invalid lifecycle transitions rejected", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const invocation = await allocateInvocation(WORKSPACE_A, 12);
    const admitted = await admit(WORKSPACE_A, invocation, 100_000);
    if (admitted.outcome !== "ADMITTED") throw new Error("admit");
    await budget.markProviderStarted({
      workspaceId: WORKSPACE_A,
      reservationId: admitted.reservation.id,
    });
    await budget.reconcile({
      workspaceId: WORKSPACE_A,
      reservation: { ...admitted.reservation, status: "PROVIDER_STARTED" },
      periodLedger: admitted.periodLedgerAfter,
      committedUsdMicros: 50_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    await expect(
      budget.markProviderStarted({
        workspaceId: WORKSPACE_A,
        reservationId: admitted.reservation.id,
      }),
    ).rejects.toThrow(/not eligible for provider start/);
  });

  it("DB17: workspace A cannot access or mutate B ledger", async () => {
    await enableBudget(WORKSPACE_A, 500_000);
    await enableBudget(WORKSPACE_B, 500_000);
    const invA = await allocateInvocation(WORKSPACE_A, 13);
    const admittedA = await admit(WORKSPACE_A, invA, 200_000);
    if (admittedA.outcome !== "ADMITTED") throw new Error("admit");

    await expect(
      budget.reconcile({
        workspaceId: WORKSPACE_B,
        reservation: admittedA.reservation,
        periodLedger: admittedA.periodLedgerAfter,
        committedUsdMicros: 100_000,
        usageKnown: true,
        providerAccepted: true,
        billableProviderOutcome: true,
      }),
    ).rejects.toThrow();
  });

  it("DB18: late reconciliation updates original UTC period", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const invocation = await allocateInvocation(WORKSPACE_A, 14);
    const admitted = await admit(WORKSPACE_A, invocation, 300_000);
    if (admitted.outcome !== "ADMITTED") throw new Error("admit");
    expect(admitted.reservation.periodKey).toBe("2026-01");

    await budget.markProviderStarted({
      workspaceId: WORKSPACE_A,
      reservationId: admitted.reservation.id,
    });

    const february = await database.db
      .insert(workspaceInferenceBudgetPeriods)
      .values({
        id: "ibperiod-feb",
        workspaceId: WORKSPACE_A,
        periodKind: "CALENDAR_MONTH_UTC",
        periodKey: "2026-02",
        periodStartUtc: new Date("2026-02-01T00:00:00.000Z"),
        periodEndExclusiveUtc: new Date("2026-03-01T00:00:00.000Z"),
        budgetPolicyVersionId: `${POLICY_VERSION_ID}-${WORKSPACE_A}`,
        limitUsdMicros: 1_000_000,
        committedLiabilityUsdMicros: 0,
        heldReservationsUsdMicros: 0,
        unresolvedUncertainLiabilityUsdMicros: 0,
        overageUsdMicros: 0,
        schemaVersion: 1,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      })
      .returning();

    const outcome = await budget.reconcile({
      workspaceId: WORKSPACE_A,
      reservation: { ...admitted.reservation, status: "PROVIDER_STARTED" },
      periodLedger: admitted.periodLedgerAfter,
      committedUsdMicros: 120_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    });

    expect(outcome.periodLedgerAfter.period.periodKey).toBe("2026-01");
    expect(february[0]?.committedLiabilityUsdMicros).toBe(0);
  });

  it("DB19: concurrent reconciliation cannot double-commit", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const invocation = await allocateInvocation(WORKSPACE_A, 15);
    const admitted = await admit(WORKSPACE_A, invocation, 350_000);
    if (admitted.outcome !== "ADMITTED") throw new Error("admit");
    await budget.markProviderStarted({
      workspaceId: WORKSPACE_A,
      reservationId: admitted.reservation.id,
    });

    const connA = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });
    const connB = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });
    const budgetA = new PostgresInferenceBudgetAdmissionRepository(connA);
    const budgetB = new PostgresInferenceBudgetAdmissionRepository(connB);
    const snapshot = {
      ...admitted.reservation,
      status: "PROVIDER_STARTED" as const,
    };
    const input = {
      workspaceId: WORKSPACE_A,
      reservation: snapshot,
      periodLedger: admitted.periodLedgerAfter,
      committedUsdMicros: 200_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    };

    const [first, second] = await Promise.all([
      budgetA.reconcile(input),
      budgetB.reconcile(input),
    ]);

    const periods = await database.db
      .select()
      .from(workspaceInferenceBudgetPeriods)
      .where(eq(workspaceInferenceBudgetPeriods.workspaceId, WORKSPACE_A));
    expect(periods[0]?.committedLiabilityUsdMicros).toBe(200_000);
    expect([first.nextStatus, second.nextStatus]).toContain("COMMITTED");

    await connA.close();
    await connB.close();
  });

  it("DB20: database failure does not grant admission", async () => {
    await enableBudget(WORKSPACE_A, 1_000_000);
    const key = reservationKey("inv-missing" as InferenceInvocationId);
    await expect(
      budget.admitOrGetExisting({
        workspaceId: WORKSPACE_A,
        reservationKey: key,
        admitCeilingUsdMicros: 300_000,
        attempt: {
          workspaceId: WORKSPACE_A,
          inferenceInvocationId: "inv-missing" as InferenceInvocationId,
          invocationAnchor: buildInferenceInvocationAnchorString(
            agentAnchor(99),
          ),
          periodKey: "2026-01" as InferenceBudgetPeriodKeyV1,
          budgetPolicyVersionId: activePolicyVersionId(WORKSPACE_A),
          pricingSnapshotId: "pricing-v1",
          providerAttemptIndex: 0,
          selectedModelProfileVersionId: PROFILE_V1,
          admitCeilingUsdMicros: 300_000,
          runAttemptId: RUN_ATTEMPT,
        },
      }),
    ).rejects.toThrow();

    const periods = await database.db
      .select()
      .from(workspaceInferenceBudgetPeriods)
      .where(eq(workspaceInferenceBudgetPeriods.workspaceId, WORKSPACE_A));
    const period = periods[0];
    expect(period?.heldReservationsUsdMicros ?? 0).toBe(0);
    const reservations = await database.db
      .select()
      .from(inferenceBudgetReservations);
    expect(reservations).toHaveLength(0);
  });
});
