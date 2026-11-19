import type { InferenceRoutingRuntimePolicyV1 } from "@osva-ai/contracts";
import { createDefaultInferenceRoutingRuntimePolicy } from "@osva-ai/contracts";

export function mergeTrustedInferenceRoutingPolicy(
  policy: InferenceRoutingRuntimePolicyV1 | null | undefined,
): InferenceRoutingRuntimePolicyV1 {
  return policy ?? createDefaultInferenceRoutingRuntimePolicy();
}
