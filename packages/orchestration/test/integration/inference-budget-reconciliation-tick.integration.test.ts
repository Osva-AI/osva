import type {
  InferenceBudgetPeriodKeyV1,
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyVersionId,
  InferenceBudgetReservationKeyV1,
  InferenceInvocationId,
  ModelProfileVersionId,
  RunAttemptId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION } from "@osva-ai/contracts";
import {
  Workspace,
  buildInferenceInvocationAnchorString,
  deriveInferenceBudgetReservationKey,
} from "@osva/domain";
import {
  afterAll,
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
  PostgresInferenceBudgetAdmissionRepository,
  PostgresInferenceBudgetOrdinalRepository,
  PostgresInferenceBudgetPolicyRepository,
  PostgresInferenceBudgetRecoveryRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../db/test/integration/postgres-harness.js";
import { InferenceBudgetReconciliationTick } from "../../src/inference-budget-reconciliation-tick.js";

const WORKSPACE = "ws-recovery-tick" as WorkspaceId;
const NOW = new Date("2026-05-20T12:00:00.000Z");
const POLICY_VERSION_ID = "ibpv-tick" as InferenceBudgetPolicyVersionId;
const RUN_ATTEMPT = "rat-tick" as RunAttemptId;
const PROFILE_V1 = "mpv-tick" as ModelProfileVersionId;
const PERIOD = "2026-05" as InferenceBudgetPeriodKeyV1;

function agentAnchor(ordinal: number, executionGeneration = 1) {
  return {
    anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
    workspaceId: WORKSPACE,
    invocationKind: "SYNC" as const,
    material: {
      scope: "AGENT_RUN" as const,
      runAttemptId: RUN_ATTEMPT,
      executionGeneration,
      bindingName: "main",
      modelInvocationOrdinal: ordinal,
    },
  };
}

describe("InferenceBudgetReconciliationTick (PostgreSQL)", () => {
  let postgres: PostgresTestContext;
  let database: Database;
  let tick: InferenceBudgetReconciliationTick;
  let admission: PostgresInferenceBudgetAdmissionRepository;
  let ordinals: PostgresInferenceBudgetOrdinalRepository;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 6,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    const recovery = new PostgresInferenceBudgetRecoveryRepository(database);
    admission = new PostgresInferenceBudgetAdmissionRepository(database);
    ordinals = new PostgresInferenceBudgetOrdinalRepository(database);
    const policies = new PostgresInferenceBudgetPolicyRepository(database);
    tick = new InferenceBudgetReconciliationTick({
      recovery,
      admission,
      policies,
      clock: { now: () => NOW },
      batchLimit: 10,
    });
  });

  async function ordinalForKey(key: string): Promise<number> {
    const result = await ordinals.allocateOrGetOrdinal({
      workspaceId: WORKSPACE,
      runAttemptId: RUN_ATTEMPT,
      bindingName: "main",
      logicalOperationKey: key,
    });
    return result.modelInvocationOrdinal;
  }

  async function admitStaleReservation(key: string) {
    const ordinal = await ordinalForKey(key);
    const invocation = await admission.allocateInvocation({
      workspaceId: WORKSPACE,
      anchor: agentAnchor(ordinal),
      periodKey: PERIOD,
      budgetPolicyVersionId: POLICY_VERSION_ID,
      pricingSnapshotId: "pricing-v1",
      runAttemptId: RUN_ATTEMPT,
    });
    const reservationKey: InferenceBudgetReservationKeyV1 =
      deriveInferenceBudgetReservationKey({
        version: "1",
        inferenceInvocationId: invocation.id,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE_V1,
      });
    const admitted = await admission.admitOrGetExisting({
      workspaceId: WORKSPACE,
      reservationKey,
      admitCeilingUsdMicros: 100_000,
      attempt: {
        workspaceId: WORKSPACE,
        inferenceInvocationId: invocation.id,
        invocationAnchor: buildInferenceInvocationAnchorString(
          agentAnchor(ordinal),
        ),
        periodKey: PERIOD,
        budgetPolicyVersionId: POLICY_VERSION_ID,
        pricingSnapshotId: "pricing-v1",
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE_V1,
        admitCeilingUsdMicros: 100_000,
        runAttemptId: RUN_ATTEMPT,
        admittedExecutionGeneration: 1,
      },
    });
    if (admitted.outcome !== "ADMITTED") {
      throw new Error("expected admit");
    }
    return admitted.reservation.id;
  }

  beforeEach(async () => {
    await resetStage0Tables(database);
    await new PostgresWorkspaceRepository(database).save(
      Workspace.create({ id: WORKSPACE, name: "Tick", createdAt: NOW }),
    );
    const policies = new PostgresInferenceBudgetPolicyRepository(database);
    const policyId = "ibp-tick" as InferenceBudgetPolicyId;
    await policies.savePolicy({
      id: policyId,
      workspaceId: WORKSPACE,
      key: "default",
      createdAt: NOW,
    });
    await policies.savePolicyVersion({
      id: POLICY_VERSION_ID,
      policyId,
      workspaceId: WORKSPACE,
      version: 1,
      definition: {
        schemaVersion: "1",
        periodKind: "CALENDAR_MONTH_UTC",
        periodLimitUsdMicros: 1_000_000,
        periodEnforcement: "STRICT_PERIOD_CAP",
        unknownAdmitCostBehavior: "DENY_ADMISSION",
        onLeaseLoss: "RECONCILIATION_REQUIRED",
        staleAdmittedReservationTtlMs: 1_000,
      },
      createdAt: NOW,
    });
    await policies.upsertWorkspaceActivation({
      workspaceId: WORKSPACE,
      enabled: true,
      activePolicyVersionId: POLICY_VERSION_ID,
      updatedAt: NOW,
    });
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
  });

  it("R-T1: tick is bounded and idempotent on empty candidate set", async () => {
    const first = await tick.execute();
    const second = await tick.execute();
    expect(first.scanned).toBe(0);
    expect(second.scanned).toBe(0);
    expect(first.released).toBe(0);
    expect(second.released).toBe(0);
  });

  it("R-T2: stale never-started ADMITTED reservations are released", async () => {
    const reservationId = await admitStaleReservation("stale-admit");
    await database.sql.unsafe(
      `UPDATE inference_budget_reservations
       SET created_at = $1::timestamptz, updated_at = $1::timestamptz
       WHERE id = $2`,
      [new Date(NOW.getTime() - 5_000).toISOString(), reservationId],
    );
    const first = await tick.execute();
    expect(first.scanned).toBeGreaterThanOrEqual(1);
    expect(first.released).toBeGreaterThanOrEqual(1);
    const second = await tick.execute();
    expect(second.released).toBe(0);
    const rows = await database.sql`
      SELECT status FROM inference_budget_reservations WHERE id = ${reservationId}
    `;
    expect(rows[0]?.status).toBe("RELEASED");
  });

  it("R-T3: PROVIDER_STARTED without lease loss is not auto-released by tick", async () => {
    const ordinal = await ordinalForKey("provider-started");
    const invocation = await admission.allocateInvocation({
      workspaceId: WORKSPACE,
      anchor: agentAnchor(ordinal),
      periodKey: PERIOD,
      budgetPolicyVersionId: POLICY_VERSION_ID,
      pricingSnapshotId: "pricing-v1",
      runAttemptId: RUN_ATTEMPT,
    });
    const reservationKey: InferenceBudgetReservationKeyV1 =
      deriveInferenceBudgetReservationKey({
        version: "1",
        inferenceInvocationId: invocation.id as InferenceInvocationId,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE_V1,
      });
    const admitted = await admission.admitOrGetExisting({
      workspaceId: WORKSPACE,
      reservationKey,
      admitCeilingUsdMicros: 100_000,
      attempt: {
        workspaceId: WORKSPACE,
        inferenceInvocationId: invocation.id,
        invocationAnchor: buildInferenceInvocationAnchorString(
          agentAnchor(ordinal),
        ),
        periodKey: PERIOD,
        budgetPolicyVersionId: POLICY_VERSION_ID,
        pricingSnapshotId: "pricing-v1",
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE_V1,
        admitCeilingUsdMicros: 100_000,
        runAttemptId: RUN_ATTEMPT,
        admittedExecutionGeneration: 1,
      },
    });
    if (admitted.outcome !== "ADMITTED") {
      throw new Error("expected admit");
    }
    const started = await admission.markProviderStarted({
      workspaceId: WORKSPACE,
      reservationId: admitted.reservation.id,
      executionGeneration: 1,
    });
    expect(started.status).toBe("PROVIDER_STARTED");
    const result = await tick.execute();
    expect(result.released).toBe(0);
    expect(result.markedReconciliationRequired).toBe(0);
    const rows = await database.sql`
      SELECT status FROM inference_budget_reservations WHERE id = ${admitted.reservation.id}
    `;
    expect(rows[0]?.status).toBe("PROVIDER_STARTED");
  });

  it("R-T4: transient release failure then successful retry without double reconciliation", async () => {
    const reservationId = await admitStaleReservation("transient-release");
    await database.sql.unsafe(
      `UPDATE inference_budget_reservations
       SET created_at = $1::timestamptz, updated_at = $1::timestamptz
       WHERE id = $2`,
      [new Date(NOW.getTime() - 5_000).toISOString(), reservationId],
    );

    const releaseSpy = vi
      .spyOn(admission, "release")
      .mockRejectedValueOnce(new Error("transient db unavailable"));

    const first = await tick.execute();
    expect(first.scanned).toBeGreaterThanOrEqual(1);
    expect(first.released).toBe(0);

    releaseSpy.mockRestore();
    const second = await tick.execute();
    expect(second.released).toBeGreaterThanOrEqual(1);
    const third = await tick.execute();
    expect(third.released).toBe(0);

    const rows = await database.sql`
      SELECT status FROM inference_budget_reservations WHERE id = ${reservationId}
    `;
    expect(rows[0]?.status).toBe("RELEASED");
  });
});
