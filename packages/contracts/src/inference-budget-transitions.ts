import type { InferenceBudgetReservationStatus } from "./inference-budget.js";
import { INFERENCE_BUDGET_TERMINAL_RESERVATION_STATUSES } from "./inference-budget.js";

const ALLOWED_TRANSITIONS: Readonly<
  Record<
    InferenceBudgetReservationStatus,
    readonly InferenceBudgetReservationStatus[]
  >
> = {
  ADMITTED: ["PROVIDER_STARTED", "RELEASED", "EXPIRED"],
  PROVIDER_STARTED: [
    "COMMITTED",
    "RECONCILIATION_REQUIRED",
    "RELEASED",
    "EXPIRED",
  ],
  COMMITTED: [],
  RELEASED: [],
  RECONCILIATION_REQUIRED: ["COMMITTED", "RELEASED"],
  EXPIRED: ["RECONCILIATION_REQUIRED"],
};

export function canTransitionInferenceBudgetReservationStatus(
  from: InferenceBudgetReservationStatus,
  to: InferenceBudgetReservationStatus,
): boolean {
  if (from === to) {
    return true;
  }
  if (
    (
      INFERENCE_BUDGET_TERMINAL_RESERVATION_STATUSES as readonly string[]
    ).includes(from) &&
    from !== "EXPIRED"
  ) {
    return false;
  }
  return (ALLOWED_TRANSITIONS[from] as readonly string[]).includes(to);
}

export function assertInferenceBudgetReservationStatusTransition(
  from: InferenceBudgetReservationStatus,
  to: InferenceBudgetReservationStatus,
): void {
  if (!canTransitionInferenceBudgetReservationStatus(from, to)) {
    throw new Error(
      `Illegal inference budget reservation status transition: ${from} -> ${to}`,
    );
  }
}
