import type {
  InferenceRoutingCapabilityRequirements,
  ModelInferenceRoutingCapabilityFlags,
  ModelProvider,
} from "@osva-ai/contracts";
import {
  MODEL_INFERENCE_ROUTING_CAPABILITIES,
  MODEL_MAX_OUTPUT_TOKENS_MAX,
} from "@osva-ai/contracts";

export interface RoutingCapabilityCheckInput {
  readonly provider: ModelProvider;
  readonly requirements: InferenceRoutingCapabilityRequirements | undefined;
  readonly hasToolDefinitions: boolean;
  readonly hasJsonSchema: boolean;
  readonly requiresStreaming: boolean;
  readonly requestedMaxOutputTokens: number | undefined;
}

export function providerRoutingCapabilities(
  provider: ModelProvider,
): ModelInferenceRoutingCapabilityFlags {
  return MODEL_INFERENCE_ROUTING_CAPABILITIES[provider];
}

export function satisfiesRoutingCapabilities(
  input: RoutingCapabilityCheckInput,
): boolean {
  const caps = providerRoutingCapabilities(input.provider);
  const requirements = input.requirements ?? {};

  if (
    requirements.requiresTextGeneration === true &&
    !caps.supportsTextGeneration
  ) {
    return false;
  }

  const needsTools =
    requirements.requiresToolCalling === true || input.hasToolDefinitions;
  if (needsTools && !caps.supportsToolCalling) {
    return false;
  }

  const needsStructured =
    requirements.requiresStructuredJsonOutput === true || input.hasJsonSchema;
  if (needsStructured && !caps.supportsStructuredJsonOutput) {
    return false;
  }

  const needsStreaming =
    requirements.requiresStreaming === true || input.requiresStreaming;
  if (needsStreaming && !caps.supportsStreaming) {
    return false;
  }

  if (requirements.minContextWindowTokens !== undefined) {
    if (
      caps.contextWindowTokens === null ||
      caps.contextWindowTokens < requirements.minContextWindowTokens
    ) {
      return false;
    }
  }

  const maxOut = input.requestedMaxOutputTokens ?? requirements.maxOutputTokens;
  if (maxOut !== undefined) {
    const providerMax = caps.maxOutputTokens ?? MODEL_MAX_OUTPUT_TOKENS_MAX;
    if (maxOut > providerMax) {
      return false;
    }
  }

  return true;
}
