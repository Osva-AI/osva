import {
  computeInferenceBudgetAvailableUsdMicros,
  type InferenceBudgetPeriodLedgerV1,
} from "@osva-ai/contracts";

import { assertSafeUsdMicros } from "./usd-micros.js";

export function calculateInferenceBudgetAvailableUsdMicros(
  ledger: InferenceBudgetPeriodLedgerV1,
): number {
  assertSafeUsdMicros(ledger.limitUsdMicros, "limitUsdMicros");
  assertSafeUsdMicros(
    ledger.committedLiabilityUsdMicros,
    "committedLiabilityUsdMicros",
  );
  assertSafeUsdMicros(
    ledger.heldReservationsUsdMicros,
    "heldReservationsUsdMicros",
  );
  assertSafeUsdMicros(
    ledger.unresolvedUncertainLiabilityUsdMicros,
    "unresolvedUncertainLiabilityUsdMicros",
  );

  const available = computeInferenceBudgetAvailableUsdMicros(ledger);
  return assertSafeUsdMicros(available, "availableUsdMicros");
}

export function hasInferenceBudgetAdmissionCapacity(input: {
  readonly ledger: InferenceBudgetPeriodLedgerV1;
  readonly admitCeilingUsdMicros: number;
}): boolean {
  const ceiling = assertSafeUsdMicros(
    input.admitCeilingUsdMicros,
    "admitCeilingUsdMicros",
  );
  return calculateInferenceBudgetAvailableUsdMicros(input.ledger) >= ceiling;
}
