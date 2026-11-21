import type {
  InferenceBudgetPeriodBucketDeltaV1,
  InferenceBudgetPeriodLedgerV1,
  InferenceBudgetReservationSnapshotV1,
} from "@osva-ai/contracts";

import { assertSafeUsdMicros, subtractUsdMicros } from "./usd-micros.js";

export function reservationHeldUsdMicros(
  reservation: Pick<
    InferenceBudgetReservationSnapshotV1,
    "status" | "reservedUsdMicros"
  >,
): number {
  if (
    reservation.status === "ADMITTED" ||
    reservation.status === "PROVIDER_STARTED"
  ) {
    return assertSafeUsdMicros(
      reservation.reservedUsdMicros,
      "reservedUsdMicros",
    );
  }
  return 0;
}

export function reservationUncertainUsdMicros(
  reservation: Pick<
    InferenceBudgetReservationSnapshotV1,
    "status" | "uncertainFloorUsdMicros" | "reservedUsdMicros"
  >,
): number {
  if (reservation.status !== "RECONCILIATION_REQUIRED") {
    return 0;
  }
  const floor =
    reservation.uncertainFloorUsdMicros ?? reservation.reservedUsdMicros;
  return assertSafeUsdMicros(floor, "uncertainFloorUsdMicros");
}

export function computeOverageUsdMicros(input: {
  readonly reservedUsdMicros: number;
  readonly committedUsdMicros: number;
}): number {
  const reserved = assertSafeUsdMicros(
    input.reservedUsdMicros,
    "reservedUsdMicros",
  );
  const committed = assertSafeUsdMicros(
    input.committedUsdMicros,
    "committedUsdMicros",
  );
  return Math.max(0, committed - reserved);
}

export function applyPeriodLedgerDelta(
  ledger: InferenceBudgetPeriodLedgerV1,
  delta: InferenceBudgetPeriodBucketDeltaV1,
): InferenceBudgetPeriodLedgerV1 {
  return {
    ...ledger,
    committedLiabilityUsdMicros: assertSafeUsdMicros(
      ledger.committedLiabilityUsdMicros + delta.committedLiabilityUsdMicros,
      "committedLiabilityUsdMicros",
    ),
    heldReservationsUsdMicros: assertSafeUsdMicros(
      ledger.heldReservationsUsdMicros + delta.heldReservationsUsdMicros,
      "heldReservationsUsdMicros",
    ),
    unresolvedUncertainLiabilityUsdMicros: assertSafeUsdMicros(
      ledger.unresolvedUncertainLiabilityUsdMicros +
        delta.unresolvedUncertainLiabilityUsdMicros,
      "unresolvedUncertainLiabilityUsdMicros",
    ),
    overageUsdMicros: assertSafeUsdMicros(
      ledger.overageUsdMicros + delta.overageUsdMicros,
      "overageUsdMicros",
    ),
  };
}

export function refundHeldReservationCapacity(input: {
  readonly ledger: InferenceBudgetPeriodLedgerV1;
  readonly reservedUsdMicros: number;
}): {
  readonly ledger: InferenceBudgetPeriodLedgerV1;
  readonly refundUsdMicros: number;
} {
  const reserved = assertSafeUsdMicros(
    input.reservedUsdMicros,
    "reservedUsdMicros",
  );
  const held = assertSafeUsdMicros(
    input.ledger.heldReservationsUsdMicros,
    "heldReservationsUsdMicros",
  );
  const refund = Math.min(reserved, held);
  return {
    refundUsdMicros: refund,
    ledger: {
      ...input.ledger,
      heldReservationsUsdMicros: subtractUsdMicros(held, refund),
    },
  };
}
