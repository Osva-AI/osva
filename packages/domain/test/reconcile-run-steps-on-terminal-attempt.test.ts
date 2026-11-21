import { describe, expect, it } from "vitest";

import { RunAttempt } from "../src/run-attempt.js";
import {
  RUN_ATTEMPT_TERMINAL_ERROR_CODE,
  RUN_STEP_NOT_FINALIZED_ERROR_CODE,
  reconciledRunStepFailureForOrphanedStep,
} from "../src/reconcile-run-steps-on-terminal-attempt.js";

const NOW = new Date("2026-03-01T12:00:00.000Z");
const LATER = new Date("2026-03-01T12:05:00.000Z");
const RUN_ID = "run-1" as import("@osva-ai/contracts").RunId;

function firstAttempt() {
  return RunAttempt.createFirst({
    id: "ra-1" as import("@osva-ai/contracts").RunAttemptId,
    runId: RUN_ID,
    createdAt: NOW,
  });
}

describe("reconcile-run-steps-on-terminal-attempt", () => {
  it("maps failed attempts to attempt error code", () => {
    const failed = firstAttempt()
      .transitionTo("RUNNING", LATER)
      .transitionTo("FAILED", LATER, {
        error: { code: "EXECUTION_TIMEOUT", message: "timeout" },
      });
    expect(reconciledRunStepFailureForOrphanedStep(failed, LATER)).toEqual({
      status: "FAILED",
      errorCode: "EXECUTION_TIMEOUT",
      completedAt: LATER,
      usageIncomplete: true,
    });
  });

  it("falls back to RUN_ATTEMPT_TERMINAL when attempt error is missing", () => {
    const failed = firstAttempt()
      .transitionTo("RUNNING", LATER)
      .transitionTo("TIMED_OUT", LATER, {
        error: { code: "  ", message: "x" },
      });
    expect(
      reconciledRunStepFailureForOrphanedStep(failed, LATER).errorCode,
    ).toBe(RUN_ATTEMPT_TERMINAL_ERROR_CODE);
  });

  it("marks orphaned steps on succeeded attempts as RUN_STEP_NOT_FINALIZED", () => {
    const succeeded = firstAttempt()
      .transitionTo("RUNNING", LATER)
      .transitionTo("SUCCEEDED", LATER, { output: { ok: true } });
    expect(reconciledRunStepFailureForOrphanedStep(succeeded, LATER)).toEqual({
      status: "FAILED",
      errorCode: RUN_STEP_NOT_FINALIZED_ERROR_CODE,
      completedAt: LATER,
      usageIncomplete: true,
    });
  });
});
