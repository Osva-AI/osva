import {
  INFERENCE_BUDGET_ERROR_CODES,
  type InferenceBudgetAdmissionEvaluateInputV1,
  type InferenceBudgetAdmissionOutcomeV1,
  type InferenceBudgetPeriodLedgerV1,
  type InferenceBudgetReservationId,
  type InferenceBudgetReservationSnapshotV1,
} from "@osva-ai/contracts";

import { hasInferenceBudgetAdmissionCapacity } from "./capacity.js";
import { assertSafeUsdMicros } from "./usd-micros.js";
import { assertInferenceBudgetWorkspaceScope } from "./workspace-scope.js";
import { resolveInferenceBudgetAdmitCeilingUsdMicros } from "./workspace-policy.js";

function assertExistingReservationMatches(input: {
  readonly existing: InferenceBudgetReservationSnapshotV1;
  readonly reservationKey: InferenceBudgetAdmissionEvaluateInputV1["reservationKey"];
  readonly workspaceId: InferenceBudgetAdmissionEvaluateInputV1["workspaceId"];
}): void {
  assertInferenceBudgetWorkspaceScope({
    workspaceId: input.workspaceId,
    reservationWorkspaceId: input.existing.workspaceId,
  });
  if (input.existing.reservationKey !== input.reservationKey) {
    throw new Error("Existing reservation key mismatch");
  }
}

/**
 * Pure admission evaluation for B5.1. Callers supply reservation identity fields
 * on `existingReservation` context via the dedicated admit orchestrator in B5.2.
 */
export function evaluateInferenceBudgetAdmission(
  input: InferenceBudgetAdmissionEvaluateInputV1 & {
    readonly newReservationId?: InferenceBudgetReservationId;
    readonly draftReservation?: Omit<
      InferenceBudgetReservationSnapshotV1,
      "id" | "status" | "reservedUsdMicros"
    >;
  },
): InferenceBudgetAdmissionOutcomeV1 {
  assertInferenceBudgetWorkspaceScope({
    workspaceId: input.workspaceId,
    ledgerWorkspaceId: input.periodLedger.workspaceId,
  });

  if (!input.activation.enabled) {
    return { outcome: "BYPASSED", reason: "ACTIVATION_DISABLED" };
  }

  if (input.policy === undefined) {
    return { outcome: "BYPASSED", reason: "POLICY_DISABLED" };
  }

  if (input.existingReservation !== undefined) {
    assertExistingReservationMatches({
      existing: input.existingReservation,
      reservationKey: input.reservationKey,
      workspaceId: input.workspaceId,
    });
    return {
      outcome: "IDEMPOTENT_EXISTING",
      reservation: input.existingReservation,
    };
  }

  const resolvedCeiling = resolveInferenceBudgetAdmitCeilingUsdMicros({
    policy: input.policy,
    admitCeilingUsdMicros: input.admitCeilingUsdMicros,
  });

  if (resolvedCeiling === null) {
    return {
      outcome: "DENIED",
      errorCode:
        INFERENCE_BUDGET_ERROR_CODES.MODEL_INFERENCE_BUDGET_UNAVAILABLE,
      retryable: false,
    };
  }

  if (
    input.newReservationId === undefined ||
    input.draftReservation === undefined
  ) {
    throw new Error(
      "newReservationId and draftReservation are required for a new admission",
    );
  }

  const ceiling = assertSafeUsdMicros(resolvedCeiling, "admitCeilingUsdMicros");

  if (
    !hasInferenceBudgetAdmissionCapacity({
      ledger: input.periodLedger,
      admitCeilingUsdMicros: ceiling,
    })
  ) {
    return {
      outcome: "DENIED",
      errorCode: INFERENCE_BUDGET_ERROR_CODES.MODEL_INFERENCE_BUDGET_EXCEEDED,
      retryable: false,
    };
  }

  const periodLedgerAfter: InferenceBudgetPeriodLedgerV1 = {
    ...input.periodLedger,
    heldReservationsUsdMicros:
      input.periodLedger.heldReservationsUsdMicros + ceiling,
  };

  const reservation: InferenceBudgetReservationSnapshotV1 = {
    ...input.draftReservation,
    id: input.newReservationId,
    workspaceId: input.workspaceId,
    reservationKey: input.reservationKey,
    status: "ADMITTED",
    reservedUsdMicros: ceiling,
    periodKey: input.draftReservation.periodKey,
    budgetPolicyVersionId: input.draftReservation.budgetPolicyVersionId,
  };

  assertInferenceBudgetWorkspaceScope({
    workspaceId: input.workspaceId,
    reservationWorkspaceId: reservation.workspaceId,
  });

  return {
    outcome: "ADMITTED",
    reservation,
    periodLedgerAfter,
  };
}

export function simulateSequentialInferenceBudgetAdmissions(input: {
  readonly initialLedger: InferenceBudgetPeriodLedgerV1;
  readonly admitCeilingsUsdMicros: readonly number[];
}): {
  readonly admittedCount: number;
  readonly deniedCount: number;
  readonly finalLedger: InferenceBudgetPeriodLedgerV1;
} {
  let ledger = input.initialLedger;
  let admittedCount = 0;
  let deniedCount = 0;

  for (const rawCeiling of input.admitCeilingsUsdMicros) {
    const ceiling = assertSafeUsdMicros(rawCeiling, "admitCeilingUsdMicros");
    if (
      hasInferenceBudgetAdmissionCapacity({
        ledger,
        admitCeilingUsdMicros: ceiling,
      })
    ) {
      ledger = {
        ...ledger,
        heldReservationsUsdMicros: ledger.heldReservationsUsdMicros + ceiling,
      };
      admittedCount += 1;
    } else {
      deniedCount += 1;
    }
  }

  return { admittedCount, deniedCount, finalLedger: ledger };
}
