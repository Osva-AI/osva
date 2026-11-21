import type {
  InferenceBudgetPolicyDefinitionV1,
  InferenceBudgetReservationSnapshotV1,
} from "@osva-ai/contracts";

export type InferenceBudgetRecoveryReservationDispositionV1 =
  | { readonly kind: "NO_OP" }
  | { readonly kind: "RELEASE_STALE_ADMITTED" }
  | {
      readonly kind: "MARK_RECONCILIATION_REQUIRED";
      readonly reason: "LEASE_LOSS" | "PROVIDER_STARTED_UNRESOLVED";
    };

export function evaluateInferenceBudgetRecoveryDisposition(input: {
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly nowMs: number;
  readonly admittedAtMs: number;
  readonly leaseLost: boolean;
  readonly policy?: InferenceBudgetPolicyDefinitionV1;
}): InferenceBudgetRecoveryReservationDispositionV1 {
  if (input.reservation.status === "ADMITTED") {
    if (
      shouldReleaseStaleAdmittedReservation({
        reservation: input.reservation,
        nowMs: input.nowMs,
        admittedAtMs: input.admittedAtMs,
        policy: input.policy,
      })
    ) {
      return { kind: "RELEASE_STALE_ADMITTED" };
    }
    return { kind: "NO_OP" };
  }

  if (input.reservation.status === "PROVIDER_STARTED" && input.leaseLost) {
    return {
      kind: "MARK_RECONCILIATION_REQUIRED",
      reason: "LEASE_LOSS",
    };
  }

  return { kind: "NO_OP" };
}

export function shouldReleaseStaleAdmittedReservation(input: {
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly nowMs: number;
  readonly admittedAtMs: number;
  readonly policy?: InferenceBudgetPolicyDefinitionV1;
}): boolean {
  if (input.reservation.status !== "ADMITTED") {
    return false;
  }
  const ttlMs = input.policy?.staleAdmittedReservationTtlMs;
  if (ttlMs === undefined || ttlMs <= 0) {
    return false;
  }
  return input.nowMs - input.admittedAtMs >= ttlMs;
}
