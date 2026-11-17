import { EXECUTION_INTERRUPTED_ERROR_CODE } from "@osva-ai/contracts";
import type { RunAttemptState } from "@osva-ai/contracts";

import type { Run } from "./run.js";
import type { RunAttempt } from "./run-attempt.js";
import { isTerminalRunAttemptState } from "./run-attempt-state-machine.js";
import { isTerminalRunState } from "./run-state-machine.js";

export function shouldFinalizeEvaluationCaseResult(
  run: Run,
  attempt: RunAttempt,
): boolean {
  if (!isTerminalRunAttemptState(attempt.status)) {
    return false;
  }

  if (attempt.status === "SUCCEEDED") {
    return true;
  }

  if (run.status === "INTERRUPTED") {
    return false;
  }

  if (
    attempt.error?.code === EXECUTION_INTERRUPTED_ERROR_CODE &&
    !isTerminalRunState(run.status)
  ) {
    return false;
  }

  return isTerminalRunState(run.status);
}

export function isRecoverableAttemptInterruption(
  attemptStatus: RunAttemptState,
  attemptErrorCode: string | undefined,
  runStatus: Run["status"],
): boolean {
  return (
    attemptStatus === "FAILED" &&
    attemptErrorCode === EXECUTION_INTERRUPTED_ERROR_CODE &&
    runStatus === "INTERRUPTED"
  );
}
