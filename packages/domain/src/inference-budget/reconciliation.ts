import {
  assertInferenceBudgetReservationStatusTransition,
  canTransitionInferenceBudgetReservationStatus,
  defaultUncertainLiabilityFloorUsdMicros,
} from "@osva-ai/contracts";
import type { InferenceBudgetPolicyDefinitionV1 } from "@osva-ai/contracts";
import type {
  InferenceBudgetPeriodBucketDeltaV1,
  InferenceBudgetPeriodLedgerV1,
  InferenceBudgetReconcileInputV1,
  InferenceBudgetReconcileOutcomeV1,
  InferenceBudgetReservationSnapshotV1,
} from "@osva-ai/contracts";

import {
  applyPeriodLedgerDelta,
  computeOverageUsdMicros,
  reservationHeldUsdMicros,
} from "./ledger-effects.js";
import { assertSafeUsdMicros } from "./usd-micros.js";
import { assertInferenceBudgetWorkspaceScope } from "./workspace-scope.js";

function zeroDelta(): InferenceBudgetPeriodBucketDeltaV1 {
  return {
    committedLiabilityUsdMicros: 0,
    heldReservationsUsdMicros: 0,
    unresolvedUncertainLiabilityUsdMicros: 0,
    overageUsdMicros: 0,
  };
}

export function transitionInferenceBudgetReservationStatus(input: {
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly to: InferenceBudgetReservationSnapshotV1["status"];
}): InferenceBudgetReservationSnapshotV1 {
  if (
    !canTransitionInferenceBudgetReservationStatus(
      input.reservation.status,
      input.to,
    )
  ) {
    assertInferenceBudgetReservationStatusTransition(
      input.reservation.status,
      input.to,
    );
  }
  return {
    ...input.reservation,
    status: input.to,
  };
}

export function markInferenceBudgetProviderStarted(input: {
  readonly reservation: InferenceBudgetReservationSnapshotV1;
}): InferenceBudgetReservationSnapshotV1 {
  return transitionInferenceBudgetReservationStatus({
    reservation: input.reservation,
    to: "PROVIDER_STARTED",
  });
}

function applyReleaseOutcome(input: {
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly periodLedger: InferenceBudgetPeriodLedgerV1;
}): InferenceBudgetReconcileOutcomeV1 {
  const held = reservationHeldUsdMicros(input.reservation);
  const periodDelta: InferenceBudgetPeriodBucketDeltaV1 = {
    ...zeroDelta(),
    heldReservationsUsdMicros: -held,
  };

  const reservationAfter = transitionInferenceBudgetReservationStatus({
    reservation: input.reservation,
    to: "RELEASED",
  });

  return {
    nextStatus: "RELEASED",
    periodDelta,
    refundHeldUsdMicros: held,
    overageUsdMicros: 0,
    committedUsdMicros: null,
    periodLedgerAfter: applyPeriodLedgerDelta(input.periodLedger, periodDelta),
    reservationAfter,
  };
}

function applyUncertainOutcome(input: {
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly periodLedger: InferenceBudgetPeriodLedgerV1;
  readonly policy?: InferenceBudgetPolicyDefinitionV1;
  readonly uncertainFloorUsdMicros?: number;
}): InferenceBudgetReconcileOutcomeV1 {
  const held = reservationHeldUsdMicros(input.reservation);
  const floor = assertSafeUsdMicros(
    input.uncertainFloorUsdMicros ??
      (input.policy === undefined
        ? input.reservation.reservedUsdMicros
        : defaultUncertainLiabilityFloorUsdMicros(
            input.policy,
            input.reservation.reservedUsdMicros,
          )),
    "uncertainFloorUsdMicros",
  );

  const reservationAfter = {
    ...transitionInferenceBudgetReservationStatus({
      reservation: input.reservation,
      to: "RECONCILIATION_REQUIRED",
    }),
    uncertainFloorUsdMicros: floor,
    committedUsdMicros: null,
  };

  const periodDelta: InferenceBudgetPeriodBucketDeltaV1 = {
    committedLiabilityUsdMicros: 0,
    heldReservationsUsdMicros: -held,
    unresolvedUncertainLiabilityUsdMicros: floor,
    overageUsdMicros: 0,
  };

  const periodLedgerAfter = applyPeriodLedgerDelta(
    input.periodLedger,
    periodDelta,
  );

  return {
    nextStatus: "RECONCILIATION_REQUIRED",
    periodDelta,
    refundHeldUsdMicros: held,
    overageUsdMicros: 0,
    committedUsdMicros: null,
    periodLedgerAfter,
    reservationAfter,
  };
}

function applyCommittedOutcome(input: {
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly periodLedger: InferenceBudgetPeriodLedgerV1;
  readonly committedUsdMicros: number;
}): InferenceBudgetReconcileOutcomeV1 {
  const committed = assertSafeUsdMicros(
    input.committedUsdMicros,
    "committedUsdMicros",
  );
  const held = reservationHeldUsdMicros(input.reservation);
  const overage = computeOverageUsdMicros({
    reservedUsdMicros: input.reservation.reservedUsdMicros,
    committedUsdMicros: committed,
  });

  const periodDelta: InferenceBudgetPeriodBucketDeltaV1 = {
    committedLiabilityUsdMicros: committed,
    heldReservationsUsdMicros: -held,
    unresolvedUncertainLiabilityUsdMicros: 0,
    overageUsdMicros: overage,
  };

  const reservationAfter = {
    ...transitionInferenceBudgetReservationStatus({
      reservation: input.reservation,
      to: "COMMITTED",
    }),
    committedUsdMicros: committed,
  };

  return {
    nextStatus: "COMMITTED",
    periodDelta,
    refundHeldUsdMicros: held,
    overageUsdMicros: overage,
    committedUsdMicros: committed,
    periodLedgerAfter: applyPeriodLedgerDelta(input.periodLedger, periodDelta),
    reservationAfter,
  };
}

export function evaluateInferenceBudgetReconciliation(
  input: InferenceBudgetReconcileInputV1 & {
    readonly policy?: InferenceBudgetPolicyDefinitionV1;
  },
): InferenceBudgetReconcileOutcomeV1 {
  if (
    input.reservation.status === "COMMITTED" &&
    input.committedUsdMicros !== null &&
    input.committedUsdMicros !== undefined &&
    input.reservation.committedUsdMicros === input.committedUsdMicros
  ) {
    return {
      nextStatus: "COMMITTED",
      periodDelta: zeroDelta(),
      refundHeldUsdMicros: 0,
      overageUsdMicros: computeOverageUsdMicros({
        reservedUsdMicros: input.reservation.reservedUsdMicros,
        committedUsdMicros: input.committedUsdMicros,
      }),
      committedUsdMicros: input.committedUsdMicros,
      periodLedgerAfter: input.periodLedger,
      reservationAfter: input.reservation,
    };
  }

  assertInferenceBudgetWorkspaceScope({
    workspaceId: input.workspaceId,
    reservationWorkspaceId: input.reservation.workspaceId,
    ledgerWorkspaceId: input.periodLedger.workspaceId,
  });

  if (
    input.periodLedger.budgetPolicyVersionId !==
    input.reservation.budgetPolicyVersionId
  ) {
    throw new Error(
      "Reconciliation must retain reservation budgetPolicyVersionId snapshot",
    );
  }
  if (input.periodLedger.period.periodKey !== input.reservation.periodKey) {
    throw new Error(
      "Reconciliation must retain reservation periodKey snapshot",
    );
  }

  if (input.nonBillableCancelBeforeAccept === true && !input.providerAccepted) {
    return applyReleaseOutcome({
      reservation: input.reservation,
      periodLedger: input.periodLedger,
    });
  }

  const committed = input.committedUsdMicros;

  if (!input.usageKnown || committed === null || committed === undefined) {
    if (input.providerAccepted || input.billableProviderOutcome) {
      return applyUncertainOutcome({
        reservation: input.reservation,
        periodLedger: input.periodLedger,
        policy: input.policy,
      });
    }
    return applyReleaseOutcome({
      reservation: input.reservation,
      periodLedger: input.periodLedger,
    });
  }

  return applyCommittedOutcome({
    reservation: input.reservation,
    periodLedger: input.periodLedger,
    committedUsdMicros: committed,
  });
}

export function releaseInferenceBudgetReservation(input: {
  readonly workspaceId: InferenceBudgetReconcileInputV1["workspaceId"];
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly periodLedger: InferenceBudgetPeriodLedgerV1;
}): InferenceBudgetReconcileOutcomeV1 {
  return evaluateInferenceBudgetReconciliation({
    workspaceId: input.workspaceId,
    reservation: input.reservation,
    periodLedger: input.periodLedger,
    committedUsdMicros: null,
    usageKnown: false,
    providerAccepted: false,
    billableProviderOutcome: false,
    nonBillableCancelBeforeAccept: true,
  });
}

export function markInferenceBudgetReconciliationRequired(input: {
  readonly workspaceId: InferenceBudgetReconcileInputV1["workspaceId"];
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly periodLedger: InferenceBudgetPeriodLedgerV1;
  readonly policy?: InferenceBudgetPolicyDefinitionV1;
  readonly uncertainFloorUsdMicros?: number;
}): InferenceBudgetReconcileOutcomeV1 {
  return applyUncertainOutcome(input);
}
