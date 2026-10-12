import type { RunAttempt } from "./run-attempt.js";

/**
 * Capability HTTP eligibility using store time, not the worker process clock.
 *
 * Legacy unleased RUNNING rows (executionOwner unset) remain eligible, matching
 * M9.3 recovery: they are not auto-failed and operators settle them manually.
 *
 * Owner/generation are not in capability tokens. A still-unexpired lease
 * authorizes capability HTTP even if generation later changes (residual TOCTOU).
 * This helper does not create a second execution lifecycle authority.
 */
export function selectCapabilityEligibleRunAttempt(
  attempt: RunAttempt | null,
  storeNow: Date,
): RunAttempt | null {
  if (attempt === null || attempt.status !== "RUNNING") {
    return null;
  }

  if (attempt.executionOwner === undefined) {
    return attempt;
  }

  return attempt.hasActiveExecutionLease(storeNow) ? attempt : null;
}
