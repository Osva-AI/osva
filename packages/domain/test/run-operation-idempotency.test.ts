import { describe, expect, it } from "vitest";

import {
  classifyRunOperationIdempotency,
  isSideEffectSafeToAutoReplay,
} from "../src/run-operation-idempotency.js";

describe("run operation idempotency", () => {
  it("defaults unknown tools to UNKNOWN_WRITE", () => {
    expect(classifyRunOperationIdempotency({ toolType: "MCP" })).toBe(
      "UNKNOWN_WRITE",
    );
  });

  it("blocks automatic recovery for pending unknown writes", () => {
    expect(isSideEffectSafeToAutoReplay("UNKNOWN_WRITE", "PENDING")).toBe(
      false,
    );
    expect(isSideEffectSafeToAutoReplay("READ_ONLY", "PENDING")).toBe(true);
    expect(isSideEffectSafeToAutoReplay("PURE", "COMMITTED")).toBe(true);
  });
});
