import {
  INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
  INFERENCE_BUDGET_ERROR_CODES,
  assertInferenceBudgetReservationStatusTransition,
  canTransitionInferenceBudgetReservationStatus,
  createDefaultInferenceBudgetPolicyDefinition,
  isInferenceBudgetNonFallbackErrorCode,
  isInferenceBudgetNonRetryableErrorCode,
  type BatchInferenceItemId,
  type EvaluationJudgeTaskId,
  type InferenceBudgetPeriodKeyV1,
  type InferenceBudgetPolicyVersionId,
  type InferenceBudgetReservationId,
  type InferenceBudgetReservationKeyV1,
  type InferenceBudgetReservationSnapshotV1,
  type InferenceInvocationAnchorContractV1,
  type InferenceInvocationId,
  type ModelProfileVersionId,
  type RunAttemptId,
  type WorkspaceId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  assertInferenceBudgetWorkspaceScope,
  buildInferenceInvocationAnchorString,
  createEmptyInferenceBudgetPeriodLedger,
  deriveInferenceBudgetReservationKey,
  evaluateInferenceBudgetAdmission,
  evaluateInferenceBudgetReconciliation,
  isDistinctLogicalInvocationAnchor,
  markInferenceBudgetProviderStarted,
  releaseInferenceBudgetReservation,
  resolveInferenceBudgetUtcPeriodIdentity,
  simulateSequentialInferenceBudgetAdmissions,
} from "../src/inference-budget/index.js";

const WORKSPACE_A = "ws_aaaaaaaaaaaaaaaa" as WorkspaceId;
const WORKSPACE_B = "ws_bbbbbbbbbbbbbbbb" as WorkspaceId;
const POLICY_VERSION = "ibpv_aaaaaaaaaaaa" as InferenceBudgetPolicyVersionId;
const INVOCATION_A = "inv_aaaaaaaaaaaaaaaa" as InferenceInvocationId;
const PROFILE_V1 = "mpv_aaaaaaaaaaaaaaaa" as ModelProfileVersionId;
const PROFILE_V2 = "mpv_bbbbbbbbbbbbbbbb" as ModelProfileVersionId;
const RUN_ATTEMPT_A = "rat_aaaaaaaaaaaaaaaa" as RunAttemptId;
const RUN_ATTEMPT_B = "rat_bbbbbbbbbbbbbbbb" as RunAttemptId;
const JUDGE_TASK_A = "ejt_aaaaaaaaaaaaaaaa" as EvaluationJudgeTaskId;
const BATCH_ITEM_A = "bii_aaaaaaaaaaaaaaaa" as BatchInferenceItemId;
const RESERVATION_ID = "ibr_aaaaaaaaaaaaaaaa" as InferenceBudgetReservationId;

function periodJanuary(): {
  readonly periodKey: InferenceBudgetPeriodKeyV1;
  readonly ledger: ReturnType<typeof createEmptyInferenceBudgetPeriodLedger>;
} {
  const period = resolveInferenceBudgetUtcPeriodIdentity(
    new Date("2026-01-15T12:00:00.000Z"),
  );
  const ledger = createEmptyInferenceBudgetPeriodLedger({
    workspaceId: WORKSPACE_A,
    period,
    budgetPolicyVersionId: POLICY_VERSION,
    limitUsdMicros: 1_000_000,
  });
  return { periodKey: period.periodKey as InferenceBudgetPeriodKeyV1, ledger };
}

function agentAnchor(
  overrides: Partial<InferenceInvocationAnchorContractV1> & {
    readonly runAttemptId?: RunAttemptId;
    readonly modelInvocationOrdinal?: number;
  } = {},
): InferenceInvocationAnchorContractV1 {
  return {
    ...overrides,
    anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
    workspaceId: WORKSPACE_A,
    invocationKind: overrides.invocationKind ?? "SYNC",
    material: {
      scope: "AGENT_RUN",
      runAttemptId: overrides.runAttemptId ?? RUN_ATTEMPT_A,
      executionGeneration: 1,
      bindingName: "main",
      modelInvocationOrdinal: overrides.modelInvocationOrdinal ?? 1,
      ...(overrides.material?.scope === "AGENT_RUN" ? overrides.material : {}),
    },
  };
}

function reservationKeyFor(input: {
  readonly inferenceInvocationId: InferenceInvocationId;
  readonly providerAttemptIndex: number;
  readonly selectedModelProfileVersionId?: ModelProfileVersionId;
}): InferenceBudgetReservationKeyV1 {
  return deriveInferenceBudgetReservationKey({
    version: "1",
    inferenceInvocationId: input.inferenceInvocationId,
    providerAttemptIndex: input.providerAttemptIndex,
    selectedModelProfileVersionId:
      input.selectedModelProfileVersionId ?? PROFILE_V1,
  });
}

function draftReservation(input: {
  readonly inferenceInvocationId: InferenceInvocationId;
  readonly reservationKey: InferenceBudgetReservationKeyV1;
  readonly providerAttemptIndex?: number;
  readonly periodKey: InferenceBudgetPeriodKeyV1;
}): Omit<
  InferenceBudgetReservationSnapshotV1,
  "id" | "status" | "reservedUsdMicros"
> {
  return {
    workspaceId: WORKSPACE_A,
    reservationKey: input.reservationKey,
    inferenceInvocationId: input.inferenceInvocationId,
    providerAttemptIndex: input.providerAttemptIndex ?? 0,
    selectedModelProfileVersionId: PROFILE_V1,
    periodKey: input.periodKey,
    budgetPolicyVersionId: POLICY_VERSION,
    pricingSnapshotId: "pricing_v1",
  };
}

describe("inference budget domain", () => {
  it("C2: reservation key determinism", () => {
    const keyA = reservationKeyFor({
      inferenceInvocationId: INVOCATION_A,
      providerAttemptIndex: 0,
    });
    const keyB = reservationKeyFor({
      inferenceInvocationId: INVOCATION_A,
      providerAttemptIndex: 0,
    });
    expect(keyA).toBe(keyB);
    const fallback = reservationKeyFor({
      inferenceInvocationId: INVOCATION_A,
      providerAttemptIndex: 1,
      selectedModelProfileVersionId: PROFILE_V2,
    });
    expect(fallback).not.toBe(keyA);
  });

  it("C3: replay identity stability", () => {
    const anchor = agentAnchor({ modelInvocationOrdinal: 3 });
    const first = buildInferenceInvocationAnchorString(anchor);
    const replay = buildInferenceInvocationAnchorString({
      ...anchor,
      invocationKind: "SYNC",
    });
    expect(first).toBe(replay);
    const differentGeneration = buildInferenceInvocationAnchorString(
      agentAnchor({
        material: {
          scope: "AGENT_RUN",
          runAttemptId: RUN_ATTEMPT_A,
          executionGeneration: 9,
          bindingName: "main",
          modelInvocationOrdinal: 3,
        },
      }),
    );
    expect(differentGeneration).toBe(first);
    const key = reservationKeyFor({
      inferenceInvocationId: INVOCATION_A,
      providerAttemptIndex: 0,
    });
    const { periodKey, ledger } = periodJanuary();
    const existing: InferenceBudgetReservationSnapshotV1 = {
      ...draftReservation({
        inferenceInvocationId: INVOCATION_A,
        reservationKey: key,
        periodKey,
      }),
      id: RESERVATION_ID,
      status: "ADMITTED",
      reservedUsdMicros: 600_000,
    };
    const outcome = evaluateInferenceBudgetAdmission({
      workspaceId: WORKSPACE_A,
      activation: { enabled: true },
      policy: createDefaultInferenceBudgetPolicyDefinition(),
      periodLedger: ledger,
      admitCeilingUsdMicros: 600_000,
      reservationKey: key,
      existingReservation: existing,
    });
    expect(outcome).toEqual({
      outcome: "IDEMPOTENT_EXISTING",
      reservation: existing,
    });
  });

  it("C4: new logical invocation identity", () => {
    const anchorA = buildInferenceInvocationAnchorString(
      agentAnchor({ modelInvocationOrdinal: 1 }),
    );
    const anchorB = buildInferenceInvocationAnchorString(
      agentAnchor({ modelInvocationOrdinal: 2 }),
    );
    expect(isDistinctLogicalInvocationAnchor(anchorA, anchorB)).toBe(true);
    const judgeAnchor = buildInferenceInvocationAnchorString({
      anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
      workspaceId: WORKSPACE_A,
      invocationKind: "JUDGE",
      material: {
        scope: "EVALUATION_JUDGE",
        evaluationJudgeTaskId: JUDGE_TASK_A,
        sequence: 1,
      },
    });
    expect(judgeAnchor).not.toBe(anchorA);
    const batchAnchor = buildInferenceInvocationAnchorString({
      anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
      workspaceId: WORKSPACE_A,
      invocationKind: "BATCH",
      material: {
        scope: "BATCH_INFERENCE",
        batchInferenceItemId: BATCH_ITEM_A,
      },
    });
    expect(batchAnchor).not.toBe(anchorA);
    const retryAnchor = buildInferenceInvocationAnchorString(
      agentAnchor({ runAttemptId: RUN_ATTEMPT_B }),
    );
    expect(retryAnchor).not.toBe(anchorA);
  });

  it("C5: admission within capacity", () => {
    const { periodKey, ledger } = periodJanuary();
    const key = reservationKeyFor({
      inferenceInvocationId: INVOCATION_A,
      providerAttemptIndex: 0,
    });
    const outcome = evaluateInferenceBudgetAdmission({
      workspaceId: WORKSPACE_A,
      activation: { enabled: true },
      policy: createDefaultInferenceBudgetPolicyDefinition(),
      periodLedger: ledger,
      admitCeilingUsdMicros: 400_000,
      reservationKey: key,
      newReservationId: RESERVATION_ID,
      draftReservation: draftReservation({
        inferenceInvocationId: INVOCATION_A,
        reservationKey: key,
        periodKey,
      }),
    });
    expect(outcome.outcome).toBe("ADMITTED");
    if (outcome.outcome === "ADMITTED") {
      expect(outcome.periodLedgerAfter.heldReservationsUsdMicros).toBe(400_000);
    }
  });

  it("C6: admission above capacity", () => {
    const { periodKey, ledger } = periodJanuary();
    const key = reservationKeyFor({
      inferenceInvocationId: INVOCATION_A,
      providerAttemptIndex: 0,
    });
    const outcome = evaluateInferenceBudgetAdmission({
      workspaceId: WORKSPACE_A,
      activation: { enabled: true },
      policy: createDefaultInferenceBudgetPolicyDefinition(),
      periodLedger: {
        ...ledger,
        heldReservationsUsdMicros: 700_000,
      },
      admitCeilingUsdMicros: 400_000,
      reservationKey: key,
      newReservationId: RESERVATION_ID,
      draftReservation: draftReservation({
        inferenceInvocationId: INVOCATION_A,
        reservationKey: key,
        periodKey,
      }),
    });
    expect(outcome).toEqual({
      outcome: "DENIED",
      errorCode: INFERENCE_BUDGET_ERROR_CODES.MODEL_INFERENCE_BUDGET_EXCEEDED,
      retryable: false,
    });
  });

  it("C7: exactly-at-limit admission", () => {
    const { periodKey, ledger } = periodJanuary();
    const key = reservationKeyFor({
      inferenceInvocationId: INVOCATION_A,
      providerAttemptIndex: 0,
    });
    const outcome = evaluateInferenceBudgetAdmission({
      workspaceId: WORKSPACE_A,
      activation: { enabled: true },
      policy: createDefaultInferenceBudgetPolicyDefinition(),
      periodLedger: ledger,
      admitCeilingUsdMicros: 1_000_000,
      reservationKey: key,
      newReservationId: RESERVATION_ID,
      draftReservation: draftReservation({
        inferenceInvocationId: INVOCATION_A,
        reservationKey: key,
        periodKey,
      }),
    });
    expect(outcome.outcome).toBe("ADMITTED");
  });

  it("C10: illegal lifecycle transitions", () => {
    expect(
      canTransitionInferenceBudgetReservationStatus("COMMITTED", "ADMITTED"),
    ).toBe(false);
    expect(() =>
      assertInferenceBudgetReservationStatusTransition("RELEASED", "ADMITTED"),
    ).toThrow(/Illegal inference budget reservation status transition/);
  });

  it("C8: concurrent admission mathematical invariant", () => {
    const { ledger } = periodJanuary();
    const simulated = simulateSequentialInferenceBudgetAdmissions({
      initialLedger: ledger,
      admitCeilingsUsdMicros: [600_000, 600_000],
    });
    expect(simulated.admittedCount).toBe(1);
    expect(simulated.deniedCount).toBe(1);
    expect(
      simulated.finalLedger.committedLiabilityUsdMicros +
        simulated.finalLedger.heldReservationsUsdMicros +
        simulated.finalLedger.unresolvedUncertainLiabilityUsdMicros,
    ).toBeLessThanOrEqual(simulated.finalLedger.limitUsdMicros);
  });

  it("C9: idempotent reconciliation", () => {
    const { periodKey, ledger } = periodJanuary();
    const reservation: InferenceBudgetReservationSnapshotV1 = {
      ...draftReservation({
        inferenceInvocationId: INVOCATION_A,
        reservationKey: reservationKeyFor({
          inferenceInvocationId: INVOCATION_A,
          providerAttemptIndex: 0,
        }),
        periodKey,
      }),
      id: RESERVATION_ID,
      status: "PROVIDER_STARTED",
      reservedUsdMicros: 500_000,
    };
    let workingLedger = {
      ...ledger,
      heldReservationsUsdMicros: 500_000,
    };
    const first = evaluateInferenceBudgetReconciliation({
      workspaceId: WORKSPACE_A,
      reservation,
      periodLedger: workingLedger,
      committedUsdMicros: 300_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    workingLedger = first.periodLedgerAfter;
    const second = evaluateInferenceBudgetReconciliation({
      workspaceId: WORKSPACE_A,
      reservation: first.reservationAfter,
      periodLedger: workingLedger,
      committedUsdMicros: 300_000,
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
    expect(second.periodLedgerAfter).toEqual(workingLedger);
  });

  it("C9b: rejects conflicting settlement once committed", () => {
    const { periodKey, ledger } = periodJanuary();
    const reservation: InferenceBudgetReservationSnapshotV1 = {
      ...draftReservation({
        inferenceInvocationId: INVOCATION_A,
        reservationKey: reservationKeyFor({
          inferenceInvocationId: INVOCATION_A,
          providerAttemptIndex: 0,
        }),
        periodKey,
      }),
      id: RESERVATION_ID,
      status: "PROVIDER_STARTED",
      reservedUsdMicros: 500_000,
    };
    const first = evaluateInferenceBudgetReconciliation({
      workspaceId: WORKSPACE_A,
      reservation,
      periodLedger: { ...ledger, heldReservationsUsdMicros: 500_000 },
      committedUsdMicros: 300_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    expect(() =>
      evaluateInferenceBudgetReconciliation({
        workspaceId: WORKSPACE_A,
        reservation: first.reservationAfter,
        periodLedger: first.periodLedgerAfter,
        committedUsdMicros: 400_000,
        usageKnown: true,
        providerAccepted: true,
        billableProviderOutcome: true,
      }),
    ).toThrow(/already committed/);
  });

  it("C11: unknown actual cost", () => {
    const { periodKey, ledger } = periodJanuary();
    const reservation: InferenceBudgetReservationSnapshotV1 = {
      ...draftReservation({
        inferenceInvocationId: INVOCATION_A,
        reservationKey: reservationKeyFor({
          inferenceInvocationId: INVOCATION_A,
          providerAttemptIndex: 0,
        }),
        periodKey,
      }),
      id: RESERVATION_ID,
      status: "PROVIDER_STARTED",
      reservedUsdMicros: 250_000,
    };
    const outcome = evaluateInferenceBudgetReconciliation({
      workspaceId: WORKSPACE_A,
      reservation,
      periodLedger: {
        ...ledger,
        heldReservationsUsdMicros: 250_000,
      },
      committedUsdMicros: null,
      usageKnown: false,
      providerAccepted: true,
      billableProviderOutcome: true,
      policy: createDefaultInferenceBudgetPolicyDefinition(),
    });
    expect(outcome.nextStatus).toBe("RECONCILIATION_REQUIRED");
    expect(outcome.committedUsdMicros).toBeNull();
    expect(
      outcome.periodLedgerAfter.unresolvedUncertainLiabilityUsdMicros,
    ).toBe(250_000);
  });

  it("C12: failed provider request with uncertain billability", () => {
    const { periodKey, ledger } = periodJanuary();
    const reservation: InferenceBudgetReservationSnapshotV1 = {
      ...draftReservation({
        inferenceInvocationId: INVOCATION_A,
        reservationKey: reservationKeyFor({
          inferenceInvocationId: INVOCATION_A,
          providerAttemptIndex: 0,
        }),
        periodKey,
      }),
      id: RESERVATION_ID,
      status: "PROVIDER_STARTED",
      reservedUsdMicros: 100_000,
    };
    const outcome = evaluateInferenceBudgetReconciliation({
      workspaceId: WORKSPACE_A,
      reservation,
      periodLedger: {
        ...ledger,
        heldReservationsUsdMicros: 100_000,
      },
      committedUsdMicros: null,
      usageKnown: false,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    expect(outcome.nextStatus).toBe("RECONCILIATION_REQUIRED");
    expect(outcome.periodLedgerAfter.heldReservationsUsdMicros).toBe(0);
  });

  it("C13: successful reservation release", () => {
    const { periodKey, ledger } = periodJanuary();
    const reservation: InferenceBudgetReservationSnapshotV1 = {
      ...draftReservation({
        inferenceInvocationId: INVOCATION_A,
        reservationKey: reservationKeyFor({
          inferenceInvocationId: INVOCATION_A,
          providerAttemptIndex: 0,
        }),
        periodKey,
      }),
      id: RESERVATION_ID,
      status: "ADMITTED",
      reservedUsdMicros: 200_000,
    };
    const outcome = releaseInferenceBudgetReservation({
      workspaceId: WORKSPACE_A,
      reservation,
      periodLedger: {
        ...ledger,
        heldReservationsUsdMicros: 200_000,
      },
    });
    expect(outcome.nextStatus).toBe("RELEASED");
    expect(outcome.periodLedgerAfter.heldReservationsUsdMicros).toBe(0);
  });

  it("C14: actual charge exceeding reservation", () => {
    const { periodKey, ledger } = periodJanuary();
    const reservation: InferenceBudgetReservationSnapshotV1 = {
      ...draftReservation({
        inferenceInvocationId: INVOCATION_A,
        reservationKey: reservationKeyFor({
          inferenceInvocationId: INVOCATION_A,
          providerAttemptIndex: 0,
        }),
        periodKey,
      }),
      id: RESERVATION_ID,
      status: "PROVIDER_STARTED",
      reservedUsdMicros: 100_000,
    };
    const outcome = evaluateInferenceBudgetReconciliation({
      workspaceId: WORKSPACE_A,
      reservation,
      periodLedger: {
        ...ledger,
        heldReservationsUsdMicros: 100_000,
      },
      committedUsdMicros: 150_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    expect(outcome.nextStatus).toBe("COMMITTED");
    expect(outcome.overageUsdMicros).toBe(50_000);
    expect(outcome.periodLedgerAfter.committedLiabilityUsdMicros).toBe(150_000);
  });

  it("C15: no double-counting of overage", () => {
    const { periodKey, ledger } = periodJanuary();
    const reservation: InferenceBudgetReservationSnapshotV1 = {
      ...draftReservation({
        inferenceInvocationId: INVOCATION_A,
        reservationKey: reservationKeyFor({
          inferenceInvocationId: INVOCATION_A,
          providerAttemptIndex: 0,
        }),
        periodKey,
      }),
      id: RESERVATION_ID,
      status: "PROVIDER_STARTED",
      reservedUsdMicros: 100_000,
    };
    const outcome = evaluateInferenceBudgetReconciliation({
      workspaceId: WORKSPACE_A,
      reservation,
      periodLedger: {
        ...ledger,
        heldReservationsUsdMicros: 100_000,
      },
      committedUsdMicros: 150_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    const ledgerAfter = outcome.periodLedgerAfter;
    expect(ledgerAfter.committedLiabilityUsdMicros).toBe(150_000);
    expect(ledgerAfter.overageUsdMicros).toBe(50_000);
    const charged =
      ledgerAfter.committedLiabilityUsdMicros +
      ledgerAfter.heldReservationsUsdMicros +
      ledgerAfter.unresolvedUncertainLiabilityUsdMicros;
    expect(charged).toBe(150_000);
  });

  it("C16: UTC month transition", () => {
    const januaryEnd = resolveInferenceBudgetUtcPeriodIdentity(
      new Date("2026-01-31T23:59:59.000Z"),
    );
    const februaryStart = resolveInferenceBudgetUtcPeriodIdentity(
      new Date("2026-02-01T00:00:00.000Z"),
    );
    expect(januaryEnd.periodKey).toBe("2026-01");
    expect(februaryStart.periodKey).toBe("2026-02");
    const december = resolveInferenceBudgetUtcPeriodIdentity(
      new Date("2025-12-31T23:59:59.000Z"),
    );
    const january = resolveInferenceBudgetUtcPeriodIdentity(
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(december.periodKey).toBe("2025-12");
    expect(january.periodKey).toBe("2026-01");
  });

  it("C17: workspace isolation in domain inputs", () => {
    expect(() =>
      assertInferenceBudgetWorkspaceScope({
        workspaceId: WORKSPACE_A,
        reservationWorkspaceId: WORKSPACE_B,
      }),
    ).toThrow();
    const { periodKey, ledger } = periodJanuary();
    const key = reservationKeyFor({
      inferenceInvocationId: INVOCATION_A,
      providerAttemptIndex: 0,
    });
    expect(() =>
      evaluateInferenceBudgetAdmission({
        workspaceId: WORKSPACE_B,
        activation: { enabled: true },
        policy: createDefaultInferenceBudgetPolicyDefinition(),
        periodLedger: ledger,
        admitCeilingUsdMicros: 100_000,
        reservationKey: key,
        newReservationId: RESERVATION_ID,
        draftReservation: draftReservation({
          inferenceInvocationId: INVOCATION_A,
          reservationKey: key,
          periodKey,
        }),
      }),
    ).toThrow();
  });

  it("C18: budget-exceeded non-retryable classification", () => {
    expect(
      isInferenceBudgetNonRetryableErrorCode(
        INFERENCE_BUDGET_ERROR_CODES.MODEL_INFERENCE_BUDGET_EXCEEDED,
      ),
    ).toBe(true);
    expect(
      isInferenceBudgetNonFallbackErrorCode(
        INFERENCE_BUDGET_ERROR_CODES.MODEL_INFERENCE_BUDGET_EXCEEDED,
      ),
    ).toBe(true);
  });

  it("marks provider started without capacity bucket change", () => {
    const { periodKey } = periodJanuary();
    const reservation: InferenceBudgetReservationSnapshotV1 = {
      ...draftReservation({
        inferenceInvocationId: INVOCATION_A,
        reservationKey: reservationKeyFor({
          inferenceInvocationId: INVOCATION_A,
          providerAttemptIndex: 0,
        }),
        periodKey,
      }),
      id: RESERVATION_ID,
      status: "ADMITTED",
      reservedUsdMicros: 10_000,
    };
    const next = markInferenceBudgetProviderStarted({ reservation });
    expect(next.status).toBe("PROVIDER_STARTED");
  });

  it("disabled activation bypasses admission", () => {
    const { periodKey, ledger } = periodJanuary();
    const key = reservationKeyFor({
      inferenceInvocationId: INVOCATION_A,
      providerAttemptIndex: 0,
    });
    const outcome = evaluateInferenceBudgetAdmission({
      workspaceId: WORKSPACE_A,
      activation: { enabled: false },
      policy: createDefaultInferenceBudgetPolicyDefinition(),
      periodLedger: ledger,
      admitCeilingUsdMicros: 900_000,
      reservationKey: key,
      newReservationId: RESERVATION_ID,
      draftReservation: draftReservation({
        inferenceInvocationId: INVOCATION_A,
        reservationKey: key,
        periodKey,
      }),
    });
    expect(outcome).toEqual({
      outcome: "BYPASSED",
      reason: "ACTIVATION_DISABLED",
    });
  });
});
