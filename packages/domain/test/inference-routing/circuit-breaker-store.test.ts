import type {
  InferenceRoutingPolicyVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  InferenceRoutingCircuitBreakerStore,
  resolveInferenceRoutingCircuitBreakerSettings,
} from "../../src/inference-routing/circuit-breaker-store.js";

describe("InferenceRoutingCircuitBreakerStore", () => {
  it("reuses registry for the same workspace and policy version", () => {
    const store = new InferenceRoutingCircuitBreakerStore();
    const first = store.resolve({
      workspaceId: "ws-1" as WorkspaceId,
      policyVersionId: "policy-v1" as InferenceRoutingPolicyVersionId,
      circuitBreaker: {
        failureThreshold: 2,
        windowMs: 60_000,
        openDurationMs: 30_000,
      },
    });
    const second = store.resolve({
      workspaceId: "ws-1" as WorkspaceId,
      policyVersionId: "policy-v1" as InferenceRoutingPolicyVersionId,
      circuitBreaker: {
        failureThreshold: 99,
        windowMs: 60_000,
        openDurationMs: 30_000,
      },
    });
    expect(second).toBe(first);
  });

  it("creates a fresh registry when the policy version changes", () => {
    const store = new InferenceRoutingCircuitBreakerStore();
    const first = store.resolve({
      workspaceId: "ws-1" as WorkspaceId,
      policyVersionId: "policy-v1" as InferenceRoutingPolicyVersionId,
      circuitBreaker: {
        failureThreshold: 2,
        windowMs: 60_000,
        openDurationMs: 30_000,
      },
    });
    const second = store.resolve({
      workspaceId: "ws-1" as WorkspaceId,
      policyVersionId: "policy-v2" as InferenceRoutingPolicyVersionId,
      circuitBreaker: {
        failureThreshold: 2,
        windowMs: 60_000,
        openDurationMs: 30_000,
      },
    });
    expect(second).not.toBe(first);
  });

  it("rejects invalid circuit breaker configuration", () => {
    expect(() =>
      resolveInferenceRoutingCircuitBreakerSettings({
        failureThreshold: 0,
        windowMs: 60_000,
        openDurationMs: 30_000,
      }),
    ).toThrow(/Invalid inference routing circuit breaker/);
  });
});
