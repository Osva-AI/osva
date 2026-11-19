import { z } from "zod";

import {
  INFERENCE_CACHE_EXECUTION_PURPOSES,
  INFERENCE_RESPONSE_CACHE_POLICY_SCHEMA_VERSION,
} from "../inference-cache.js";
import { modelProfileVersionIdSchema } from "./ids.js";
import {
  generateCompletionInputSchema,
  modelProviderSchema,
} from "./model-gateway.js";

export const inferenceResponseCachePolicySchema = z.strictObject({
  schemaVersion: z.literal(INFERENCE_RESPONSE_CACHE_POLICY_SCHEMA_VERSION),
  enabled: z.boolean(),
  ttlSeconds: z.int().positive().optional(),
  determinism: z.enum(["PROVIDER_DEFAULT", "REQUIRED_DETERMINISTIC"]),
  allowEvaluationJudgeCache: z.boolean().optional(),
  allowToolDefinitions: z.boolean().optional(),
  maxEntryBytes: z.int().positive().optional(),
  cachePolicyRevisionId: z.string().min(1).max(128).optional(),
});

export const inferenceCacheExecutionPurposeSchema = z.enum(
  INFERENCE_CACHE_EXECUTION_PURPOSES,
);

export const inferenceCacheRequestMaterialSchema = z.strictObject({
  modelProfileVersionId: modelProfileVersionIdSchema,
  modelProviderConnectionVersionId: z.string().min(1).optional(),
  provider: modelProviderSchema,
  configuredModelId: z.string().min(1).max(256),
  messages: generateCompletionInputSchema.shape.messages,
  maxOutputTokens: generateCompletionInputSchema.shape.maxOutputTokens,
  toolDefinitions: generateCompletionInputSchema.shape.toolDefinitions,
  jsonSchema: generateCompletionInputSchema.shape.jsonSchema,
  cachePolicyVersionId: z.string().min(1).max(128).optional(),
  routingPolicyVersionId: z.string().min(1).max(128).optional(),
});
