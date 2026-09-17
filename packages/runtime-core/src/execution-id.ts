import type { RunAttemptId } from "@osva/contracts";

/**
 * Runtime Protocol executionId has a 1:1 identity with canonical RunAttempt.
 * Queue delivery IDs are never used.
 */
export function toRuntimeExecutionId(runAttemptId: RunAttemptId): string {
  return runAttemptId;
}
