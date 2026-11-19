import type {
  InferenceRoutingCircuitBreakerSettings,
  InferenceRoutingPolicyVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { parseInferenceRoutingCircuitBreakerSettings } from "@osva-ai/contracts";

import { InferenceRoutingCircuitBreakerRegistry } from "./circuit-breaker.js";

function storeKey(
  workspaceId: WorkspaceId,
  policyVersionId: InferenceRoutingPolicyVersionId,
): string {
  return `${workspaceId as string}:${policyVersionId as string}`;
}

export function resolveInferenceRoutingCircuitBreakerSettings(
  raw: unknown,
): InferenceRoutingCircuitBreakerSettings {
  return parseInferenceRoutingCircuitBreakerSettings(raw);
}

/**
 * Per-workspace, per-active-policy-version circuit breaker registries.
 * State is retained while the policy version remains active; a new policy
 * version gets a fresh registry (documented per-worker limitation).
 */
export class InferenceRoutingCircuitBreakerStore {
  private readonly registries = new Map<
    string,
    InferenceRoutingCircuitBreakerRegistry
  >();

  resolve(input: {
    readonly workspaceId: WorkspaceId;
    readonly policyVersionId: InferenceRoutingPolicyVersionId;
    readonly circuitBreaker: unknown;
  }): InferenceRoutingCircuitBreakerRegistry {
    const key = storeKey(input.workspaceId, input.policyVersionId);
    const existing = this.registries.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const settings = resolveInferenceRoutingCircuitBreakerSettings(
      input.circuitBreaker,
    );
    const created = new InferenceRoutingCircuitBreakerRegistry(settings);
    this.registries.set(key, created);
    return created;
  }
}
