import {
  INFERENCE_MODEL_INVOCATION_SOURCES,
  type InferenceModelInvocationSource,
} from "@osva-ai/contracts";

export function isInferenceModelInvocationSource(
  value: string,
): value is InferenceModelInvocationSource {
  return (INFERENCE_MODEL_INVOCATION_SOURCES as readonly string[]).includes(
    value,
  );
}

export function isOsvaResponseCacheHit(
  source: InferenceModelInvocationSource | undefined,
): boolean {
  return source === "OSVA_RESPONSE_CACHE_HIT";
}
