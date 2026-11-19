import type { InferenceResponseCachePolicyV1 } from "@osva-ai/contracts";
import { createDefaultInferenceResponseCachePolicy } from "@osva-ai/contracts";

export function mergeTrustedInferenceResponseCachePolicy(
  policy: InferenceResponseCachePolicyV1 | null | undefined,
): InferenceResponseCachePolicyV1 {
  return policy ?? createDefaultInferenceResponseCachePolicy();
}
