/**
 * B5.4C acceptance — PostgreSQL authority, recovery tick, accounting invariants.
 * Maps to matrix IDs documented per test (A/R/B/J/D subsets).
 */
import type {
  EvaluationJudgeTaskId,
  InferenceBudgetPeriodKeyV1,
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyVersionId,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
  computeInferenceBudgetAvailableUsdMicros,
} from "@osva-ai/contracts";
import {
  Workspace,
  buildInferenceInvocationAnchorString,
  calculateInferenceBudgetAvailableUsdMicros,
  deriveInferenceBudgetReservationKey,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  createDatabase,
  migrateDatabase,
  PostgresInferenceBudgetAdmissionRepository,
  PostgresInferenceBudgetPolicyRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "../../src/index.js";
import { workspaceInferenceBudgetPeriods } from "../../src/schema/workspace-inference-budget-periods.js";
import { inferenceBudgetReservations } from "../../src/schema/inference-budget-reservations.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const WS_A = "ws-b54c-a" as WorkspaceId;
const WS_B = "ws-b54c-b" as WorkspaceId;
const POLICY_V = "ibpv-b54c" as InferenceBudgetPolicyVersionId;
const PROFILE = "mpv-b54c" as ModelProfileVersionId;
const PERIOD = "2026-03" as InferenceBudgetPeriodKeyV1;
const NOW = new Date("2026-03-15T12:00:00.000Z");

function assertLedgerInvariant(
  ledger: import("@osva-ai/contracts").InferenceBudgetPeriodLedgerV1,
  label: string,
): void {
  expect(ledger.limitUsdMicros).toBeGreaterThanOrEqual(0);
  expect(ledger.committedLiabilityUsdMicros).toBeGreaterThanOrEqual(0);
  expect(ledger.heldReservationsUsdMicros).toBeGreaterThanOrEqual(0);
  expect(ledger.unresolvedUncertainLiabilityUsdMicros).toBeGreaterThanOrEqual(
    0,
  );
  const availableContract = computeInferenceBudgetAvailableUsdMicros(ledger);
  const availableDomain = calculateInferenceBudgetAvailableUsdMicros(ledger);
  expect(availableDomain).toBe(availableContract);
  expect(availableContract).toBeGreaterThanOrEqual(0);
  expect(
    ledger.committedLiabilityUsdMicros +
      ledger.heldReservationsUsdMicros +
      ledger.unresolvedUncertainLiabilityUsdMicros,
  ).toBeLessThanOrEqual(ledger.limitUsdMicros);
  void label;
}

describe("B5.4C PostgreSQL acceptance", () => {
  let postgres: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let policies: PostgresInferenceBudgetPolicyRepository;
  let budget: PostgresInferenceBudgetAdmissionRepository;
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
    await resetStage0Tables(database);
    for (const [id, name] of [
      [WS_A, "A"],
      [WS_B, "B"],
    ] as const) {
      await workspaces.save(Workspace.create({ id, name, createdAt: NOW }));
      const policyId = `ibp-${id}` as InferenceBudgetPolicyId;
      await policies.savePolicy({
        id: policyId,
        workspaceId: id,
        key: "default",
        createdAt: NOW,
      });
      await policies.savePolicyVersion({
        id: `${POLICY_V}-${id}` as InferenceBudgetPolicyVersionId,
        policyId,
        workspaceId: id,
        version: 1,
        definition: {
          schemaVersion: "1",
          periodKind: "CALENDAR_MONTH_UTC",
          periodLimitUsdMicros: 2_000_000,
          periodEnforcement: "STRICT_PERIOD_CAP",
          unknownAdmitCostBehavior: "DENY_ADMISSION",
          onLeaseLoss: "RECONCILIATION_REQUIRED",
          staleAdmittedReservationTtlMs: 2_000,
        },
        createdAt: NOW,
      });
    }
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
  });

  async function enableWorkspace(
    workspaceId: WorkspaceId,
    enabled: boolean,
    limitMicros = 2_000_000,
  ): Promise<InferenceBudgetPolicyVersionId> {
    const versionId =
      limitMicros === 2_000_000
        ? (`${POLICY_V}-${workspaceId}` as InferenceBudgetPolicyVersionId)
        : (`${POLICY_V}-lim${limitMicros}-${workspaceId}` as InferenceBudgetPolicyVersionId);
    if (enabled && limitMicros !== 2_000_000) {
      await policies.savePolicyVersion({
        id: versionId,
        policyId: `ibp-${workspaceId}` as InferenceBudgetPolicyId,
        workspaceId,
        version: 2,
        definition: {
          schemaVersion: "1",
          periodKind: "CALENDAR_MONTH_UTC",
          periodLimitUsdMicros: limitMicros,
          periodEnforcement: "STRICT_PERIOD_CAP",
          unknownAdmitCostBehavior: "DENY_ADMISSION",
          onLeaseLoss: "RECONCILIATION_REQUIRED",
          staleAdmittedReservationTtlMs: 2_000,
        },
        createdAt: NOW,
      });
    }
    await policies.upsertWorkspaceActivation({
      workspaceId,
      enabled,
      activePolicyVersionId: enabled ? versionId : undefined,
      updatedAt: NOW,
    });
    return versionId;
  }

  it("A1/D7: disabled workspace bypasses admission (BYPASSED)", async () => {
    await policies.upsertWorkspaceActivation({
      workspaceId: WS_A,
      enabled: false,
      activePolicyVersionId: undefined,
      updatedAt: NOW,
    });
    const versionId = `${POLICY_V}-${WS_A}` as InferenceBudgetPolicyVersionId;
    const anchor = {
      anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
      workspaceId: WS_A,
      invocationKind: "JUDGE" as const,
      material: {
        scope: "EVALUATION_JUDGE" as const,
        evaluationJudgeTaskId: "ejt-off" as EvaluationJudgeTaskId,
        sequence: 1,
      },
    };
    const inv = await budget.allocateInvocation({
      workspaceId: WS_A,
      anchor,
      periodKey: PERIOD,
      budgetPolicyVersionId: versionId,
      pricingSnapshotId: `mpv:${PROFILE}`,
    });
    const outcome = await budget.admitOrGetExisting({
      workspaceId: WS_A,
      reservationKey: deriveInferenceBudgetReservationKey({
        version: "1",
        inferenceInvocationId: inv.id,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE,
      }),
      admitCeilingUsdMicros: 100_000,
      attempt: {
        workspaceId: WS_A,
        inferenceInvocationId: inv.id,
        invocationAnchor: buildInferenceInvocationAnchorString(anchor),
        periodKey: PERIOD,
        budgetPolicyVersionId: versionId,
        pricingSnapshotId: `mpv:${PROFILE}`,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE,
        admitCeilingUsdMicros: 100_000,
      },
    });
    expect(outcome.outcome).toBe("BYPASSED");
    const rows = await database.db
      .select()
      .from(inferenceBudgetReservations)
      .where(eq(inferenceBudgetReservations.workspaceId, WS_A));
    expect(rows.length).toBe(0);
  });

  it("J4/B5-A4: judge anchor idempotent — no double reservation", async () => {
    await enableWorkspace(WS_A, true);
    const taskId = "ejt-j4" as EvaluationJudgeTaskId;
    const anchor = {
      anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
      workspaceId: WS_A,
      invocationKind: "JUDGE" as const,
      material: {
        scope: "EVALUATION_JUDGE" as const,
        evaluationJudgeTaskId: taskId,
        sequence: 1,
      },
    };
    const versionId = `${POLICY_V}-${WS_A}` as InferenceBudgetPolicyVersionId;
    const inv = await budget.allocateInvocation({
      workspaceId: WS_A,
      anchor,
      periodKey: PERIOD,
      budgetPolicyVersionId: versionId,
      pricingSnapshotId: `mpv:${PROFILE}`,
    });
    const key = deriveInferenceBudgetReservationKey({
      version: "1",
      inferenceInvocationId: inv.id,
      providerAttemptIndex: 0,
      selectedModelProfileVersionId: PROFILE,
    });
    const attempt = {
      workspaceId: WS_A,
      inferenceInvocationId: inv.id,
      invocationAnchor: buildInferenceInvocationAnchorString(anchor),
      periodKey: PERIOD,
      budgetPolicyVersionId: versionId,
      pricingSnapshotId: `mpv:${PROFILE}`,
      providerAttemptIndex: 0,
      selectedModelProfileVersionId: PROFILE,
      admitCeilingUsdMicros: 200_000,
    };
    const first = await budget.admitOrGetExisting({
      workspaceId: WS_A,
      reservationKey: key,
      admitCeilingUsdMicros: 200_000,
      attempt,
    });
    const second = await budget.admitOrGetExisting({
      workspaceId: WS_A,
      reservationKey: key,
      admitCeilingUsdMicros: 200_000,
      attempt,
    });
    expect(first.outcome).toBe("ADMITTED");
    expect(second.outcome).toBe("IDEMPOTENT_EXISTING");
    if (first.outcome === "ADMITTED") {
      assertLedgerInvariant(first.periodLedgerAfter, "j4");
    }
    const count = await database.db
      .select()
      .from(inferenceBudgetReservations)
      .where(eq(inferenceBudgetReservations.reservationKey, key));
    expect(count.length).toBe(1);
  });

  it("J6/B5-A15/B10: cross-workspace isolation", async () => {
    await enableWorkspace(WS_A, true, 100_000);
    await enableWorkspace(WS_B, true, 5_000_000);
    const anchorA = {
      anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
      workspaceId: WS_A,
      invocationKind: "BATCH" as const,
      material: {
        scope: "BATCH_INFERENCE" as const,
        batchInferenceItemId: "bi-a1" as never,
      },
    };
    const versionA = `${POLICY_V}-${WS_A}` as InferenceBudgetPolicyVersionId;
    const invA = await budget.allocateInvocation({
      workspaceId: WS_A,
      anchor: anchorA,
      periodKey: PERIOD,
      budgetPolicyVersionId: versionA,
      pricingSnapshotId: `mpv:${PROFILE}`,
    });
    const denied = await budget.admitOrGetExisting({
      workspaceId: WS_A,
      reservationKey: deriveInferenceBudgetReservationKey({
        version: "1",
        inferenceInvocationId: invA.id,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE,
      }),
      admitCeilingUsdMicros: 200_000,
      attempt: {
        workspaceId: WS_A,
        inferenceInvocationId: invA.id,
        invocationAnchor: buildInferenceInvocationAnchorString(anchorA),
        periodKey: PERIOD,
        budgetPolicyVersionId: versionA,
        pricingSnapshotId: `mpv:${PROFILE}`,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE,
        admitCeilingUsdMicros: 200_000,
      },
    });
    expect(denied.outcome).toBe("DENIED");

    const anchorB = {
      ...anchorA,
      workspaceId: WS_B,
      material: {
        scope: "BATCH_INFERENCE" as const,
        batchInferenceItemId: "bi-b1" as never,
      },
    };
    const versionB = `${POLICY_V}-${WS_B}` as InferenceBudgetPolicyVersionId;
    const invB = await budget.allocateInvocation({
      workspaceId: WS_B,
      anchor: anchorB,
      periodKey: PERIOD,
      budgetPolicyVersionId: versionB,
      pricingSnapshotId: `mpv:${PROFILE}`,
    });
    const admittedB = await budget.admitOrGetExisting({
      workspaceId: WS_B,
      reservationKey: deriveInferenceBudgetReservationKey({
        version: "1",
        inferenceInvocationId: invB.id,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE,
      }),
      admitCeilingUsdMicros: 200_000,
      attempt: {
        workspaceId: WS_B,
        inferenceInvocationId: invB.id,
        invocationAnchor: buildInferenceInvocationAnchorString(anchorB),
        periodKey: PERIOD,
        budgetPolicyVersionId: versionB,
        pricingSnapshotId: `mpv:${PROFILE}`,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE,
        admitCeilingUsdMicros: 200_000,
      },
    });
    expect(admittedB.outcome).toBe("ADMITTED");
    if (admittedB.outcome !== "ADMITTED") {
      throw new Error("expected B admit");
    }
    await expect(
      budget.reconcile({
        workspaceId: WS_A,
        reservation: admittedB.reservation,
        periodLedger: admittedB.periodLedgerAfter,
        committedUsdMicros: 50_000,
        usageKnown: true,
        providerAccepted: true,
        billableProviderOutcome: true,
      }),
    ).rejects.toThrow();
  });

  it("D7: activation enabled after initial BYPASS — subsequent admit holds capacity", async () => {
    await enableWorkspace(WS_A, false);
    const runtimeOff = await policies.findRuntimePolicyByWorkspaceId(WS_A);
    expect(runtimeOff?.enabled).not.toBe(true);
    await enableWorkspace(WS_A, true, 500_000);
    const runtimeOn = await policies.findRuntimePolicyByWorkspaceId(WS_A);
    expect(runtimeOn?.enabled).toBe(true);
    const anchor = {
      anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
      workspaceId: WS_A,
      invocationKind: "JUDGE" as const,
      material: {
        scope: "EVALUATION_JUDGE" as const,
        evaluationJudgeTaskId: "ejt-d7" as EvaluationJudgeTaskId,
        sequence: 1,
      },
    };
    const versionId = `${POLICY_V}-${WS_A}` as InferenceBudgetPolicyVersionId;
    const inv = await budget.allocateInvocation({
      workspaceId: WS_A,
      anchor,
      periodKey: PERIOD,
      budgetPolicyVersionId: versionId,
      pricingSnapshotId: `mpv:${PROFILE}`,
    });
    const admitted = await budget.admitOrGetExisting({
      workspaceId: WS_A,
      reservationKey: deriveInferenceBudgetReservationKey({
        version: "1",
        inferenceInvocationId: inv.id,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE,
      }),
      admitCeilingUsdMicros: 100_000,
      attempt: {
        workspaceId: WS_A,
        inferenceInvocationId: inv.id,
        invocationAnchor: buildInferenceInvocationAnchorString(anchor),
        periodKey: PERIOD,
        budgetPolicyVersionId: versionId,
        pricingSnapshotId: `mpv:${PROFILE}`,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE,
        admitCeilingUsdMicros: 100_000,
      },
    });
    expect(admitted.outcome).toBe("ADMITTED");
    if (admitted.outcome === "ADMITTED") {
      assertLedgerInvariant(admitted.periodLedgerAfter, "d7");
      expect(admitted.periodLedgerAfter.heldReservationsUsdMicros).toBe(
        100_000,
      );
    }
  });

  it("R6/B5-A21: PROVIDER_STARTED unknown usage → RECONCILIATION_REQUIRED", async () => {
    await enableWorkspace(WS_A, true);
    const versionId = `${POLICY_V}-${WS_A}` as InferenceBudgetPolicyVersionId;
    const anchor = {
      anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
      workspaceId: WS_A,
      invocationKind: "SYNC" as const,
      material: {
        scope: "AGENT_RUN" as const,
        runAttemptId: "rat-r6" as never,
        executionGeneration: 1,
        bindingName: "main",
        modelInvocationOrdinal: 1,
      },
    };
    const inv = await budget.allocateInvocation({
      workspaceId: WS_A,
      anchor,
      periodKey: PERIOD,
      budgetPolicyVersionId: versionId,
      pricingSnapshotId: `mpv:${PROFILE}`,
    });
    const key = deriveInferenceBudgetReservationKey({
      version: "1",
      inferenceInvocationId: inv.id,
      providerAttemptIndex: 0,
      selectedModelProfileVersionId: PROFILE,
    });
    const admitted = await budget.admitOrGetExisting({
      workspaceId: WS_A,
      reservationKey: key,
      admitCeilingUsdMicros: 150_000,
      attempt: {
        workspaceId: WS_A,
        inferenceInvocationId: inv.id,
        invocationAnchor: buildInferenceInvocationAnchorString(anchor),
        periodKey: PERIOD,
        budgetPolicyVersionId: versionId,
        pricingSnapshotId: `mpv:${PROFILE}`,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE,
        admitCeilingUsdMicros: 150_000,
      },
    });
    if (admitted.outcome !== "ADMITTED") throw new Error("admit");
    const started = await budget.markProviderStarted({
      workspaceId: WS_A,
      reservationId: admitted.reservation.id,
    });
    const uncertain = await budget.reconcile({
      workspaceId: WS_A,
      reservation: started,
      periodLedger: admitted.periodLedgerAfter,
      committedUsdMicros: null,
      usageKnown: false,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    expect(uncertain.reservationAfter.status).toBe("RECONCILIATION_REQUIRED");
    assertLedgerInvariant(uncertain.periodLedgerAfter, "r6");
    expect(
      uncertain.periodLedgerAfter.unresolvedUncertainLiabilityUsdMicros,
    ).toBeGreaterThan(0);
  });

  it("B12/DB13: overage records committed beyond reservation", async () => {
    await enableWorkspace(WS_A, true, 5_000_000);
    const versionId = `${POLICY_V}-${WS_A}` as InferenceBudgetPolicyVersionId;
    const anchor = {
      anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
      workspaceId: WS_A,
      invocationKind: "BATCH" as const,
      material: {
        scope: "BATCH_INFERENCE" as const,
        batchInferenceItemId: "bi-b12" as never,
      },
    };
    const inv = await budget.allocateInvocation({
      workspaceId: WS_A,
      anchor,
      periodKey: PERIOD,
      budgetPolicyVersionId: versionId,
      pricingSnapshotId: `mpv:${PROFILE}`,
    });
    const admitted = await budget.admitOrGetExisting({
      workspaceId: WS_A,
      reservationKey: deriveInferenceBudgetReservationKey({
        version: "1",
        inferenceInvocationId: inv.id,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE,
      }),
      admitCeilingUsdMicros: 100_000,
      attempt: {
        workspaceId: WS_A,
        inferenceInvocationId: inv.id,
        invocationAnchor: buildInferenceInvocationAnchorString(anchor),
        periodKey: PERIOD,
        budgetPolicyVersionId: versionId,
        pricingSnapshotId: `mpv:${PROFILE}`,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE,
        admitCeilingUsdMicros: 100_000,
      },
    });
    if (admitted.outcome !== "ADMITTED") throw new Error("admit");
    const started = await budget.markProviderStarted({
      workspaceId: WS_A,
      reservationId: admitted.reservation.id,
    });
    const outcome = await budget.reconcile({
      workspaceId: WS_A,
      reservation: started,
      periodLedger: admitted.periodLedgerAfter,
      committedUsdMicros: 350_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    expect(outcome.periodDelta.overageUsdMicros).toBeGreaterThan(0);
    assertLedgerInvariant(outcome.periodLedgerAfter, "b12");
    const [row] = await database.db
      .select()
      .from(workspaceInferenceBudgetPeriods)
      .where(eq(workspaceInferenceBudgetPeriods.workspaceId, WS_A));
    expect(row?.overageUsdMicros).toBeGreaterThan(0);
  });
});
