import { describe, expect, it } from "vitest";

import { executionRequestSchema } from "../src/schemas/runtime-protocol.js";

const validRequest = {
  runId: "run-1",
  runAttemptId: "attempt-1",
  agentVersionId: "agent-version-1",
  input: { prompt: "hello" },
  effectiveConfig: {},
  modelProfileVersionBindings: {},
  toolGrants: [],
  timeoutMs: 30_000,
  policyContext: {},
};

describe("Runtime Protocol v1 request", () => {
  it("parses a valid execution request", () => {
    const parsed = executionRequestSchema.parse(validRequest);
    expect(parsed.runId).toBe("run-1");
    expect(parsed.runAttemptId).toBe("attempt-1");
  });

  it("requires runAttemptId", () => {
    const withoutAttempt: Record<string, unknown> = { ...validRequest };
    delete withoutAttempt.runAttemptId;
    const parsed = executionRequestSchema.safeParse(withoutAttempt);
    expect(parsed.success).toBe(false);
  });

  it("does not treat generic executionId as a request field", () => {
    expect("executionId" in executionRequestSchema.shape).toBe(false);

    const parsed = executionRequestSchema.safeParse({
      ...validRequest,
      executionId: "execution-1",
    });
    expect(parsed.success).toBe(false);
  });
});
