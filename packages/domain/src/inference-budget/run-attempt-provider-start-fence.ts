import { InferenceBudgetProviderStartFenceError } from "@osva-ai/contracts";

export interface RunAttemptExecutionLeaseSnapshotV1 {
  readonly status: string;
  readonly executionOwner: string | null;
  readonly executionGeneration: number;
  readonly leaseExpiresAt: Date | null;
}

export function assertRunAttemptExecutionLeaseForProviderStart(input: {
  readonly attempt: RunAttemptExecutionLeaseSnapshotV1;
  readonly now: Date;
  readonly expectedExecutionOwner?: string;
  readonly expectedExecutionGeneration?: number;
}): void {
  if (input.attempt.status !== "RUNNING") {
    throw new InferenceBudgetProviderStartFenceError(
      "Run attempt is not in an executable state for provider start.",
    );
  }

  if (
    input.expectedExecutionOwner !== undefined &&
    input.attempt.executionOwner !== input.expectedExecutionOwner
  ) {
    throw new InferenceBudgetProviderStartFenceError(
      "Execution owner does not match the active run attempt lease.",
    );
  }

  if (
    input.expectedExecutionGeneration !== undefined &&
    input.attempt.executionGeneration !== input.expectedExecutionGeneration
  ) {
    throw new InferenceBudgetProviderStartFenceError(
      "Execution ownership generation does not match admitted reservation fence.",
    );
  }

  if (
    input.attempt.leaseExpiresAt === null ||
    input.attempt.leaseExpiresAt.getTime() <= input.now.getTime()
  ) {
    throw new InferenceBudgetProviderStartFenceError(
      "Run attempt execution lease is not active for provider start.",
    );
  }

  if (input.attempt.executionOwner === null) {
    throw new InferenceBudgetProviderStartFenceError(
      "Run attempt has no active execution owner for provider start.",
    );
  }
}
