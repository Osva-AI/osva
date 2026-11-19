import { z } from "zod";

import {
  INFERENCE_ROUTING_DEFAULT_CIRCUIT_BREAKER,
  INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
  INFERENCE_ROUTING_SELECTION_REASONS,
  INFERENCE_ROUTING_STRATEGIES,
  INFERENCE_ROUTING_UNKNOWN_COST_BEHAVIORS,
  INFERENCE_ROUTING_UNKNOWN_LATENCY_BEHAVIORS,
  type InferenceRoutingCircuitBreakerSettings,
} from "../inference-routing.js";
import { MODEL_PROVIDERS } from "../model-gateway.js";
import {
  inferenceRoutingPolicyVersionIdSchema,
  modelProfileVersionIdSchema,
} from "./ids.js";

const routingPolicyVersionIdSchema = z.string().min(1).max(128);
const routingPolicyIdSchema = z.string().min(1).max(128);
const routingDecisionIdSchema = z.string().min(1).max(128);

export const inferenceRoutingCapabilityRequirementsSchema = z.object({
  requiresTextGeneration: z.boolean().optional(),
  requiresToolCalling: z.boolean().optional(),
  requiresStructuredJsonOutput: z.boolean().optional(),
  requiresStreaming: z.boolean().optional(),
  minContextWindowTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

export const inferenceRoutingCircuitBreakerSchema = z.object({
  failureThreshold: z.number().int().min(1).max(1_000),
  windowMs: z.number().int().min(1_000).max(3_600_000),
  openDurationMs: z.number().int().min(1_000).max(3_600_000),
  halfOpenProbeSuccessThreshold: z.number().int().min(1).max(100).optional(),
});

export const inferenceRoutingQualityThresholdSchema = z.object({
  evaluationSuiteVersionId: z.string().min(1).max(128),
  metricKey: z.string().min(1).max(128),
  minimumScore: z.number().finite(),
});

export const inferenceRoutingPolicyDefinitionSchema = z.object({
  schemaVersion: z.literal(INFERENCE_ROUTING_POLICY_SCHEMA_VERSION),
  strategy: z.enum(INFERENCE_ROUTING_STRATEGIES),
  candidateModelProfileVersionIds: z
    .array(modelProfileVersionIdSchema)
    .min(1)
    .max(64),
  preferredModelProfileVersionId: modelProfileVersionIdSchema.optional(),
  allowedProviders: z.array(z.enum(MODEL_PROVIDERS)).max(8).optional(),
  allowedRegions: z.array(z.string().min(1).max(64)).max(16).optional(),
  maxEstimatedCostUsdMicros: z.number().int().nonnegative().optional(),
  latencyTargetMs: z.number().int().positive().optional(),
  capabilityRequirements:
    inferenceRoutingCapabilityRequirementsSchema.optional(),
  fallbackModelProfileVersionIds: z
    .array(modelProfileVersionIdSchema)
    .max(64)
    .optional(),
  maxProviderAttempts: z.number().int().min(1).max(16).optional(),
  circuitBreaker: inferenceRoutingCircuitBreakerSchema.optional(),
  allowFallback: z.boolean().optional(),
  unknownCostBehavior: z
    .enum(INFERENCE_ROUTING_UNKNOWN_COST_BEHAVIORS)
    .optional(),
  unknownLatencyBehavior: z
    .enum(INFERENCE_ROUTING_UNKNOWN_LATENCY_BEHAVIORS)
    .optional(),
  qualityThreshold: inferenceRoutingQualityThresholdSchema.optional(),
});

export const inferenceRoutingRuntimePolicySchema = z.object({
  schemaVersion: z.literal(INFERENCE_ROUTING_POLICY_SCHEMA_VERSION),
  enabled: z.boolean(),
  policyVersionId: routingPolicyVersionIdSchema.optional(),
  definition: inferenceRoutingPolicyDefinitionSchema.optional(),
  policyRevisionId: z.string().min(1).max(128).optional(),
});

export const createInferenceRoutingPolicyRequestSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  definition: inferenceRoutingPolicyDefinitionSchema,
});

export const appendInferenceRoutingPolicyVersionRequestSchema = z.object({
  definition: inferenceRoutingPolicyDefinitionSchema,
});

export const activateInferenceRoutingPolicyRequestSchema = z.object({
  policyVersionId: inferenceRoutingPolicyVersionIdSchema,
  enabled: z.boolean(),
});

export const inferenceRoutingPolicyResourceSchema = z.object({
  id: routingPolicyIdSchema,
  workspaceId: z.string().min(1),
  key: z.string().min(1).max(64),
  createdAt: z.string().datetime(),
});

export const inferenceRoutingPolicyVersionResourceSchema = z.object({
  id: routingPolicyVersionIdSchema,
  policyId: routingPolicyIdSchema,
  workspaceId: z.string().min(1),
  version: z.number().int().positive(),
  definition: inferenceRoutingPolicyDefinitionSchema,
  createdAt: z.string().datetime(),
});

export const inferenceRoutingDecisionResourceSchema = z.object({
  id: routingDecisionIdSchema,
  workspaceId: z.string().min(1),
  policyVersionId: routingPolicyVersionIdSchema,
  strategy: z.enum(INFERENCE_ROUTING_STRATEGIES),
  selectedModelProfileVersionId: modelProfileVersionIdSchema,
  selectionReason: z.enum(INFERENCE_ROUTING_SELECTION_REASONS),
  eligibleCandidateCount: z.number().int().nonnegative(),
  fallbackCount: z.number().int().nonnegative(),
  providerAttemptCount: z.number().int().nonnegative(),
  finalOutcome: z.enum(["SUCCEEDED", "FAILED", "IN_PROGRESS"]),
  runId: z.string().min(1).optional(),
  runStepId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
});

export function parseInferenceRoutingCircuitBreakerSettings(
  raw: unknown,
): InferenceRoutingCircuitBreakerSettings {
  if (raw === undefined || raw === null) {
    return INFERENCE_ROUTING_DEFAULT_CIRCUIT_BREAKER;
  }
  const parsed = inferenceRoutingCircuitBreakerSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid inference routing circuit breaker configuration: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
