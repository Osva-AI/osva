import type { RunAttempt } from "./run-attempt.js";
import { isTerminalRunAttemptState } from "./run-attempt-state-machine.js";
import type { FinalizeRunStepProps } from "./run-step.js";

export const RUN_STEP_NOT_FINALIZED_ERROR_CODE = "RUN_STEP_NOT_FINALIZED";
export const RUN_ATTEMPT_TERMINAL_ERROR_CODE = "RUN_ATTEMPT_TERMINAL";

/**
 * Failure props for a RUNNING RunStep left behind when its RunAttempt reaches
 * a terminal state without normal finalization.
 */
export function reconciledRunStepFailureForOrphanedStep(
  attempt: RunAttempt,
  completedAt: Date,
): Pick<
  FinalizeRunStepProps,
  "status" | "errorCode" | "completedAt" | "usageIncomplete"
> {
  if (!isTerminalRunAttemptState(attempt.status)) {
    throw new Error(
      "reconciledRunStepFailureForOrphanedStep requires a terminal RunAttempt.",
    );
  }

  if (attempt.status === "SUCCEEDED") {
    return {
      status: "FAILED",
      errorCode: RUN_STEP_NOT_FINALIZED_ERROR_CODE,
      completedAt,
      usageIncomplete: true,
    };
  }

  const code = attempt.error?.code?.trim();
  return {
    status: "FAILED",
    errorCode:
      code !== undefined && code.length > 0
        ? code
        : RUN_ATTEMPT_TERMINAL_ERROR_CODE,
    completedAt,
    usageIncomplete: true,
  };
}

export function shouldReconcileRunStepsForTerminalAttempt(
  attempt: RunAttempt,
): boolean {
  return isTerminalRunAttemptState(attempt.status);
}
