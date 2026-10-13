import {
  EXECUTION_INTERRUPTED_ERROR_CODE,
  type RunAttemptExecutionDiagnosticsV1,
  type RunAttemptExecutionStateV1,
} from "@osva-ai/contracts";

import type { InfrastructureMetadata, RunAttempt } from "./run-attempt.js";

const ALLOWED_RECOVERY_REASONS = new Set(["LEASE_EXPIRED"]);

export function toRunAttemptExecutionDiagnostics(
  attempt: RunAttempt,
  observedAt: Date,
): RunAttemptExecutionDiagnosticsV1 {
  const recoveryReason = recoveryReasonFrom(attempt.infrastructureMetadata);
  const interrupted =
    attempt.error?.code === EXECUTION_INTERRUPTED_ERROR_CODE ||
    recoveryReason === "LEASE_EXPIRED";
  const leased =
    attempt.status === "RUNNING" &&
    attempt.executionOwner !== undefined &&
    attempt.leaseExpiresAt !== undefined;
  const state = executionState(
    attempt,
    observedAt,
    interrupted,
    recoveryReason,
  );

  return {
    state,
    leased,
    ...(attempt.leaseExpiresAt === undefined
      ? {}
      : { leaseExpiresAt: attempt.leaseExpiresAt.toISOString() }),
    executionGeneration: attempt.executionGeneration,
    interrupted,
    ...(recoveryReason === undefined ? {} : { recoveryReason }),
    observedAt: observedAt.toISOString(),
  };
}

function executionState(
  attempt: RunAttempt,
  observedAt: Date,
  interrupted: boolean,
  recoveryReason: string | undefined,
): RunAttemptExecutionStateV1 {
  switch (attempt.status) {
    case "PENDING":
      return "queued";
    case "SUCCEEDED":
      return "completed";
    case "CANCELLED":
      return "cancelled";
    case "TIMED_OUT":
      return "timed_out";
    case "FAILED":
      return interrupted || recoveryReason === "LEASE_EXPIRED"
        ? "interrupted"
        : "failed";
    case "RUNNING": {
      if (
        attempt.executionOwner === undefined ||
        attempt.leaseExpiresAt === undefined
      ) {
        return "running_unleased";
      }
      return attempt.leaseExpiresAt.getTime() > observedAt.getTime()
        ? "running_leased"
        : "running_lease_expired";
    }
    default:
      return "failed";
  }
}

function recoveryReasonFrom(
  metadata: InfrastructureMetadata | undefined,
): string | undefined {
  const recovery = metadata?.recovery;
  if (
    recovery === undefined ||
    typeof recovery !== "object" ||
    recovery === null
  ) {
    return undefined;
  }

  const reason = Reflect.get(recovery, "reason");
  if (typeof reason !== "string" || reason.length === 0) {
    return undefined;
  }

  return ALLOWED_RECOVERY_REASONS.has(reason) ? reason : undefined;
}
