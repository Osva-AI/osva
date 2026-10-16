import { describe, expect, it } from "vitest";

import { printSuccess } from "../scripts/lib/output.js";

describe("Hello Agent output safety", () => {
  it("does not embed API keys in success output", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      printSuccess({
        runId: "run-1",
        runAttemptId: "attempt-1",
        agentId: "agent-1",
        agentVersionId: "av-1",
        status: "SUCCEEDED",
        output: { echoed: "Hello OSVA" },
        reusedAgentVersion: true,
        deployTarget: "./trusted-runtime/hello-agent.js",
        integrity: `sha256:${"a".repeat(64)}`,
        timing: {
          environmentReadyMs: 1,
          agentRegistrationMs: 2,
          runSubmissionMs: 3,
          runToTerminalMs: 4,
          totalMs: 5,
          developerCommandCount: 1,
        },
      });
    } finally {
      console.log = original;
    }
    const joined = lines.join("\n");
    expect(joined).not.toMatch(/osva_ak_|Bearer /i);
    expect(joined).toContain("SUCCEEDED");
  });
});
