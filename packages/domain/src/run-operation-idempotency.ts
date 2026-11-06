import type { RunOperationIdempotencyClass } from "@osva-ai/contracts";
export { isSideEffectSafeToAutoReplay } from "@osva-ai/contracts";

/**
 * Maps persisted tool metadata to conservative journal idempotency classes.
 * Unknown or unclassified tools default to UNKNOWN_WRITE.
 */
export function classifyRunOperationIdempotency(input: {
  readonly toolType: "INTERNAL" | "MCP";
  readonly idempotencyBehavior?: string;
  readonly internalImplementationId?: string;
}): RunOperationIdempotencyClass {
  const behavior = input.idempotencyBehavior?.trim().toUpperCase();
  if (behavior === "READ_ONLY" || behavior === "READONLY") {
    return "READ_ONLY";
  }
  if (
    behavior === "IDEMPOTENT" ||
    behavior === "IDEMPOTENT_WRITE" ||
    behavior === "AT_LEAST_ONCE_IDEMPOTENT"
  ) {
    return "IDEMPOTENT_WRITE";
  }
  if (behavior === "RECONCILE" || behavior === "RECONCILIATION") {
    return "RECONCILE";
  }
  if (behavior === "PURE" || behavior === "DETERMINISTIC") {
    return "PURE";
  }

  if (input.toolType === "INTERNAL") {
    if (
      input.internalImplementationId === "OSVA_ECHO_V1" ||
      input.internalImplementationId === "OSVA_CLOCK_NOW_V1"
    ) {
      return "PURE";
    }
  }

  return "UNKNOWN_WRITE";
}
