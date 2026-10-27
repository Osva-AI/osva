import { describe, expect, it } from "vitest";

import { ConsoleApiError } from "../src/client/lib/console-api";
import {
  describeConsoleApiError,
  describeHttpStatusGuidance,
  describeModelConnectivityResult,
  describeRunAttemptFailureGuidance,
  describeRunLifecycleGuidance,
} from "../src/client/lib/operator-diagnostics";

describe("operator diagnostics", () => {
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
