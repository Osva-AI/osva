import type { ExecutionRequest } from "@osva-ai/contracts";
import { describe, expect, it, vi } from "vitest";

import { resolveTrustedRuntimeModelGateway } from "../src/trusted-typescript-runtime-adapter.js";

const execution = {
  runId: "run-1",
} as ExecutionRequest;

describe("resolveTrustedRuntimeModelGateway", () => {
  it("S6: does not fall back to unscoped gateway when scoped factory exists", () => {
    const scoped = { generateText: vi.fn() };
    const unscoped = { generateText: vi.fn() };
    const resolved = resolveTrustedRuntimeModelGateway(
      () => scoped,
      execution,
      unscoped,
    );
    expect(resolved).toBe(scoped);
    expect(resolved).not.toBe(unscoped);
  });

  it("uses fallback only when scoped factory is absent", () => {
    const unscoped = { generateText: vi.fn() };
    expect(
      resolveTrustedRuntimeModelGateway(undefined, execution, unscoped),
    ).toBe(unscoped);
  });
});
