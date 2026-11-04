import { describe, expect, it } from "vitest";

import { ConsoleApiError } from "../src/client/lib/console-api";
import { formatAttemptDuration } from "../src/client/lib/formatting";
import {
  describeConsoleApiError,
  describeHttpStatusGuidance,
  describeModelConnectivityResult,
  describeRunAttemptFailureGuidance,
  describeRunLifecycleGuidance,
} from "../src/client/lib/operator-diagnostics";

describe("operator diagnostics", () => {
  it("shows in progress for live attempts without completedAt", () => {
    expect(
      formatAttemptDuration("2026-01-01T00:00:00.000Z", undefined, true),
    ).toBe("In progress");
  });

  it("warns when a terminal Run has a RUNNING attempt selected", () => {
    const guidance = describeRunLifecycleGuidance({
      runStatus: "FAILED",
      attemptStatus: "RUNNING",
    });
    expect(guidance?.title).toMatch(/Status mismatch/i);
    expect(guidance?.explanation).toMatch(/Run\.status/i);
    expect(guidance?.title).not.toBe("Execution in progress");
  });

  it("omits RunSteps next steps when failure guidance has no steps", () => {
    const guidance = describeRunAttemptFailureGuidance({
      error: { code: "RUN_FAILED", message: "boom" },
      runStepCount: 0,
    });
    expect(guidance?.nextSteps.join(" ")).toMatch(
      /no RunSteps were persisted/i,
    );
    expect(guidance?.nextSteps.join(" ")).not.toMatch(
      /Inspect RunSteps in the execution timeline/i,
    );
  });

  it("does not claim worker failure for QUEUED runs", () => {
    const guidance = describeRunLifecycleGuidance({ runStatus: "QUEUED" });
    expect(guidance?.title).toBe("Queued for execution");
    expect(guidance?.explanation).toMatch(/waiting to be picked up/i);
    expect(guidance?.nextSteps.join(" ")).toMatch(
      /cannot determine worker health/i,
    );
    expect(guidance?.explanation).not.toMatch(/worker is offline/i);
  });

  it("maps EXECUTION_INTERRUPTED to non-recoverable attempt guidance", () => {
    const guidance = describeRunAttemptFailureGuidance({
      error: {
        code: "EXECUTION_INTERRUPTED",
        message: "Execution lease expired; worker ownership was lost.",
      },
      execution: { interrupted: true } as never,
    });
    expect(guidance?.title).toBe("Execution interrupted");
    expect(guidance?.nextSteps.join(" ")).toMatch(/new Run/i);
  });

  it("surfaces rate limit guidance for Console API errors", () => {
    const guidance = describeConsoleApiError(
      new ConsoleApiError(429, {
        error: "Control plane rate limit exceeded. Wait before retrying.",
        code: "RATE_LIMITED",
      }),
    );
    expect(guidance?.title).toBe("Rate limited");
    expect(guidance?.nextSteps.join(" ")).toMatch(
      /does not automatically retry/i,
    );
  });

  it("distinguishes model connectivity READY from FAILED", () => {
    const ready = describeModelConnectivityResult({ status: "READY" });
    const failed = describeModelConnectivityResult({
      status: "FAILED",
      code: "MODEL_PROVIDER_UNAUTHORIZED",
    });
    expect(ready.severity).toBe("info");
    expect(failed.title).toMatch(/credentials/i);
    expect(failed.severity).toBe("error");
  });

  it("maps create_run 403 without referencing API keys in browser", () => {
    const guidance = describeHttpStatusGuidance(403, "create_run");
    expect(guidance?.explanation).toMatch(/human session/i);
    expect(guidance?.explanation).not.toMatch(/API key/i);
  });
});
