import type { RunOperationIdempotencyClass } from "./run-operation-journal.js";

export function isSideEffectSafeToAutoReplay(
  idempotencyClass: RunOperationIdempotencyClass,
  status: "PENDING" | "COMMITTED" | "UNCERTAIN" | "FAILED",
): boolean {
  if (status === "COMMITTED") {
    return true;
  }
  if (status === "UNCERTAIN") {
    return false;
  }
  if (
    idempotencyClass === "UNKNOWN_WRITE" ||
    idempotencyClass === "RECONCILE"
  ) {
    return false;
  }
  if (status === "FAILED") {
    return idempotencyClass === "PURE" || idempotencyClass === "READ_ONLY";
  }
  if (status === "PENDING") {
    return idempotencyClass === "READ_ONLY";
  }
  return false;
}
