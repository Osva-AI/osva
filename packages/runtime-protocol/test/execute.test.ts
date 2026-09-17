import { describe, expect, it } from "vitest";

import {
  RUNTIME_PROTOCOL_VERSION,
  runtimeExecuteRequestSchema,
  runtimeExecuteResponseSchema,
} from "../src/index.js";

const validRequest = {
  protocolVersion: RUNTIME_PROTOCOL_VERSION,
  executionId: "run-attempt-1",
  input: { prompt: "hello" },
  capabilities: {
    endpoint: "http://127.0.0.1:9/v1/runtime/capabilities",
    token: "opaque-token",
  },
};

describe("Runtime Protocol V1 execute schemas", () => {
  it("parses a JSON-safe execute request", () => {
    const parsed = runtimeExecuteRequestSchema.parse(validRequest);
    expect(parsed.protocolVersion).toBe("1");
    expect(parsed.executionId).toBe("run-attempt-1");
    expect(parsed.input).toEqual({ prompt: "hello" });
  });

  it("rejects missing protocol version and non-JSON input", () => {
    expect(
      runtimeExecuteRequestSchema.safeParse({
        executionId: "run-attempt-1",
        input: {},
        capabilities: validRequest.capabilities,
      }).success,
    ).toBe(false);

    expect(
      runtimeExecuteRequestSchema.safeParse({
        ...validRequest,
        input: undefined,
      }).success,
    ).toBe(false);

    expect(
      runtimeExecuteRequestSchema.safeParse({
        ...validRequest,
        protocolVersion: "2",
      }).success,
    ).toBe(false);
  });

  it("requires the remote response to echo protocolVersion and executionId", () => {
    const parsed = runtimeExecuteResponseSchema.parse({
      protocolVersion: "1",
      executionId: "run-attempt-1",
      outcome: "SUCCEEDED",
      output: { ok: true },
    });
    expect(parsed.outcome).toBe("SUCCEEDED");

    expect(
      runtimeExecuteResponseSchema.safeParse({
        outcome: "SUCCEEDED",
        output: {},
      }).success,
    ).toBe(false);

    expect(
      runtimeExecuteResponseSchema.safeParse({
        protocolVersion: "1",
        executionId: "run-attempt-1",
        outcome: "FAILED",
        error: { code: "AGENT_EXECUTION_FAILED", message: "boom", stack: "no" },
      }).success,
    ).toBe(false);
  });
});
