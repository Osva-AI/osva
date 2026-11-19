import type {
  InferenceRoutingDecisionId,
  InferenceRoutingPolicyId,
  InferenceRoutingPolicyVersionId,
  ModelProfileVersionId,
  ModelProviderConnectionVersionId,
  RunId,
  RunStepId,
  WorkspaceId,
} from "./ids.js";
import type {
  ModelErrorCode,
  ModelProvider,
  ModelConversationMessage,
} from "./model-gateway.js";
import type { ModelProfileVersionPricing } from "./model-pricing.js";

export const INFERENCE_ROUTING_POLICY_SCHEMA_VERSION = "1" as const;

export type InferenceRoutingPolicySchemaVersion =
  typeof INFERENCE_ROUTING_POLICY_SCHEMA_VERSION;

export const INFERENCE_ROUTING_STRATEGIES = [
  "FIXED",
  "LOWEST_ESTIMATED_COST",
  "LOWEST_MEASURED_LATENCY",
  "BALANCED",
  "PRIORITY_WITH_FALLBACK",
] as const;

export type InferenceRoutingStrategy =
  (typeof INFERENCE_ROUTING_STRATEGIES)[number];

export const INFERENCE_ROUTING_UNKNOWN_COST_BEHAVIORS = [
  "EXCLUDE_FROM_RANKING",
  "ALLOW_ELIGIBLE_BUT_DONT_RANK_AS_CHEAPEST",
] as const;

export type InferenceRoutingUnknownCostBehavior =
  (typeof INFERENCE_ROUTING_UNKNOWN_COST_BEHAVIORS)[number];

export const INFERENCE_ROUTING_UNKNOWN_LATENCY_BEHAVIORS = [
  "POLICY_ORDER",
  "EXCLUDE_FROM_LATENCY_RANKING",
] as const;

export type InferenceRoutingUnknownLatencyBehavior =
  (typeof INFERENCE_ROUTING_UNKNOWN_LATENCY_BEHAVIORS)[number];

export const INFERENCE_ROUTING_SELECTION_REASONS = [
  "FIXED_PREFERRED",
  "LOWEST_ESTIMATED_COST",
  "LOWEST_MEASURED_LATENCY",
  "BALANCED_SCORE",
  "POLICY_PRIORITY",
  "FALLBACK_AFTER_RETRYABLE_FAILURE",
  "ONLY_ELIGIBLE_CANDIDATE",
  "CIRCUIT_BREAKER_RECOVERY_PROBE",
] as const;

export type InferenceRoutingSelectionReason =
  (typeof INFERENCE_ROUTING_SELECTION_REASONS)[number];

export interface InferenceRoutingCapabilityRequirements {
  readonly requiresTextGeneration?: boolean;
  readonly requiresToolCalling?: boolean;
  readonly requiresStructuredJsonOutput?: boolean;
  readonly requiresStreaming?: boolean;
  readonly minContextWindowTokens?: number;
  readonly maxOutputTokens?: number;
}

export interface InferenceRoutingCircuitBreakerSettings {
  readonly failureThreshold: number;
  readonly windowMs: number;
  readonly openDurationMs: number;
  readonly halfOpenProbeSuccessThreshold?: number;
}

export interface InferenceRoutingQualityThreshold {
  readonly evaluationSuiteVersionId: string;
  readonly metricKey: string;
  readonly minimumScore: number;
}

/**
 * Immutable routing policy definition (version body).
 */
export interface InferenceRoutingPolicyDefinitionV1 {
  readonly schemaVersion: InferenceRoutingPolicySchemaVersion;
  readonly strategy: InferenceRoutingStrategy;
  readonly candidateModelProfileVersionIds: readonly ModelProfileVersionId[];
  readonly preferredModelProfileVersionId?: ModelProfileVersionId;
  readonly allowedProviders?: readonly ModelProvider[];
  readonly allowedRegions?: readonly string[];
  readonly maxEstimatedCostUsdMicros?: number;
  readonly latencyTargetMs?: number;
  readonly capabilityRequirements?: InferenceRoutingCapabilityRequirements;
  readonly fallbackModelProfileVersionIds?: readonly ModelProfileVersionId[];
  readonly maxProviderAttempts?: number;
  readonly circuitBreaker?: InferenceRoutingCircuitBreakerSettings;
  readonly allowFallback?: boolean;
  readonly unknownCostBehavior?: InferenceRoutingUnknownCostBehavior;
  readonly unknownLatencyBehavior?: InferenceRoutingUnknownLatencyBehavior;
  readonly qualityThreshold?: InferenceRoutingQualityThreshold;
}

export interface InferenceRoutingPolicyVersionRecordV1 {
  readonly id: InferenceRoutingPolicyVersionId;
  readonly policyId: InferenceRoutingPolicyId;
  readonly workspaceId: WorkspaceId;
  readonly version: number;
  readonly definition: InferenceRoutingPolicyDefinitionV1;
  readonly createdAt: string;
}

export interface InferenceRoutingPolicyRecordV1 {
  readonly id: InferenceRoutingPolicyId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly createdAt: string;
}

/**
 * Workspace runtime activation. Default: disabled, no active version.
 */
export interface WorkspaceInferenceRoutingActivationV1 {
  readonly schemaVersion: InferenceRoutingPolicySchemaVersion;
  readonly workspaceId: WorkspaceId;
  readonly enabled: boolean;
  readonly activePolicyVersionId?: InferenceRoutingPolicyVersionId;
  readonly updatedAt: string;
}

/**
 * Resolved policy injected into ExecutionRequest.policyContext when routing is on.
 */
export interface InferenceRoutingRuntimePolicyV1 {
  readonly schemaVersion: InferenceRoutingPolicySchemaVersion;
  readonly enabled: boolean;
  readonly policyVersionId?: InferenceRoutingPolicyVersionId;
  readonly definition?: InferenceRoutingPolicyDefinitionV1;
  readonly policyRevisionId?: string;
}

export interface InferenceRoutingCostEstimate {
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly estimatedCostUsdMicros: number | null;
  readonly pricingKnown: boolean;
}

export interface InferenceRoutingLatencyObservation {
  readonly sampleCount: number;
  readonly medianCompletionMs: number | null;
  readonly sufficientEvidence: boolean;
}

export interface InferenceRoutingAttemptRecord {
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly modelProviderConnectionVersionId?: ModelProviderConnectionVersionId;
  readonly outcome: "SUCCEEDED" | "FAILED" | "SKIPPED";
  readonly failureCode?: ModelErrorCode;
  readonly retryable?: boolean;
  readonly estimatedCostUsdMicros?: number | null;
  readonly observedCostUsdMicros?: number | null;
  readonly completionLatencyMs?: number;
  readonly providerRequestId?: string;
}

export interface InferenceRoutingDecisionRecordV1 {
  readonly schemaVersion: InferenceRoutingPolicySchemaVersion;
  readonly id?: InferenceRoutingDecisionId;
  readonly workspaceId: WorkspaceId;
  readonly policyVersionId: InferenceRoutingPolicyVersionId;
  readonly strategy: InferenceRoutingStrategy;
  readonly selectedModelProfileVersionId: ModelProfileVersionId;
  readonly selectedConnectionVersionId?: ModelProviderConnectionVersionId;
  readonly selectionReason: InferenceRoutingSelectionReason;
  readonly eligibleCandidateCount: number;
  readonly fallbackCount: number;
  readonly providerAttemptCount: number;
  readonly estimatedCost?: InferenceRoutingCostEstimate;
  readonly attempts: readonly InferenceRoutingAttemptRecord[];
  readonly runId?: RunId;
  readonly runStepId?: RunStepId;
  readonly bindingName?: string;
  readonly finalOutcome: "SUCCEEDED" | "FAILED" | "IN_PROGRESS";
}

export interface ModelInferenceRoutingCapabilityFlags {
  readonly supportsTextGeneration: boolean;
  readonly supportsToolCalling: boolean;
  readonly supportsStructuredJsonOutput: boolean;
  readonly supportsStreaming: boolean;
  readonly contextWindowTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly unsupportedCapabilities: readonly string[];
}

export const MODEL_INFERENCE_ROUTING_CAPABILITIES: Readonly<
  Record<ModelProvider, ModelInferenceRoutingCapabilityFlags>
> = {
  OPENAI: {
    supportsTextGeneration: true,
    supportsToolCalling: true,
    supportsStructuredJsonOutput: true,
    supportsStreaming: true,
    contextWindowTokens: 128_000,
    maxOutputTokens: 16_384,
    unsupportedCapabilities: [],
  },
  ANTHROPIC: {
    supportsTextGeneration: true,
    supportsToolCalling: true,
    supportsStructuredJsonOutput: true,
    supportsStreaming: true,
    contextWindowTokens: 200_000,
    maxOutputTokens: 16_384,
    unsupportedCapabilities: [],
  },
  GOOGLE_GEMINI: {
    supportsTextGeneration: true,
    supportsToolCalling: true,
    supportsStructuredJsonOutput: true,
    supportsStreaming: true,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 8_192,
    unsupportedCapabilities: [],
  },
};

export const INFERENCE_ROUTING_LATENCY_MIN_SAMPLES = 5;

export const INFERENCE_ROUTING_DEFAULT_CIRCUIT_BREAKER: InferenceRoutingCircuitBreakerSettings =
  {
    failureThreshold: 5,
    windowMs: 60_000,
    openDurationMs: 30_000,
    halfOpenProbeSuccessThreshold: 2,
  };

export function createDefaultInferenceRoutingRuntimePolicy(): InferenceRoutingRuntimePolicyV1 {
  return {
    schemaVersion: INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
    enabled: false,
  };
}

export function createDefaultInferenceRoutingPolicyDefinition(): InferenceRoutingPolicyDefinitionV1 {
  return {
    schemaVersion: INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
    strategy: "FIXED",
    candidateModelProfileVersionIds: [],
    allowFallback: false,
    maxProviderAttempts: 1,
    unknownCostBehavior: "EXCLUDE_FROM_RANKING",
    unknownLatencyBehavior: "POLICY_ORDER",
    circuitBreaker: INFERENCE_ROUTING_DEFAULT_CIRCUIT_BREAKER,
  };
}

/**
 * Heuristic pre-call input token estimate from conversation messages (not provider tokenizer).
 */
export function estimateRoutingInputTokens(
  messages: readonly ModelConversationMessage[],
): number {
  let chars = 0;
  for (const message of messages) {
    if ("content" in message && typeof message.content === "string") {
      chars += message.content.length;
    }
  }
  return Math.max(1, Math.ceil(chars / 4));
}

export function estimateRoutingPreflightCostUsdMicros(input: {
  readonly estimatedInputTokens: number;
  readonly maxOutputTokens: number | undefined;
  readonly pricing: ModelProfileVersionPricing | undefined;
}): InferenceRoutingCostEstimate {
  const estimatedOutputTokens = input.maxOutputTokens ?? 1_024;
  if (input.pricing === undefined) {
    return {
      estimatedInputTokens: input.estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUsdMicros: null,
      pricingKnown: false,
    };
  }

  const inputMicros =
    (BigInt(input.estimatedInputTokens) *
      BigInt(input.pricing.inputUsdMicrosPerMillionTokens) +
      500_000n) /
    1_000_000n;
  const outputMicros =
    (BigInt(estimatedOutputTokens) *
      BigInt(input.pricing.outputUsdMicrosPerMillionTokens) +
      500_000n) /
    1_000_000n;
  const total = Number(inputMicros + outputMicros);

  return {
    estimatedInputTokens: input.estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsdMicros: total,
    pricingKnown: true,
  };
}
