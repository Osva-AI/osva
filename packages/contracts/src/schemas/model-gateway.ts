import { z } from "zod";

import { jsonSchemaRecordSchema } from "./json-schema.js";
import { modelProfileVersionIdSchema } from "./ids.js";
import {
  MODEL_MAX_OUTPUT_TOKENS_MAX,
  MODEL_MAX_OUTPUT_TOKENS_MIN,
  MODEL_PROVIDERS,
  MODEL_TEXT_CONTENT_MAX_LENGTH,
  MODEL_TEXT_MAX_MESSAGES,
  MODEL_TEXT_ROLES,
  MODEL_PROVIDER_MODEL_ID_MAX_LENGTH,
} from "../model-gateway.js";

const modelToolDefinitionSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  inputSchema: jsonSchemaRecordSchema,
});

export const modelRequestSchema = z.strictObject({
  modelProfileVersionId: modelProfileVersionIdSchema,
  instructions: z.string(),
  input: z.unknown(),
  structuredOutputSchema: jsonSchemaRecordSchema.optional(),
  toolDefinitions: z.array(modelToolDefinitionSchema).optional(),
  timeoutMs: z.int().positive(),
  metadata: z.record(z.string(), z.unknown()),
});

export const modelUsageSchema = z.strictObject({
  inputUnits: z.int().nonnegative(),
  outputUnits: z.int().nonnegative(),
  cachedUnits: z.int().nonnegative().optional(),
});

export const modelResponseSchema = z.strictObject({
  provider: z.string().min(1),
  model: z.string().min(1),
  providerResponseId: z.string().min(1).optional(),
  output: z.unknown(),
  usage: modelUsageSchema,
  estimatedCost: z.number().nonnegative().optional(),
  latencyMs: z.int().nonnegative(),
});

export const modelProviderSchema = z.enum(MODEL_PROVIDERS);

export const modelProviderModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(MODEL_PROVIDER_MODEL_ID_MAX_LENGTH);

export const modelTextMessageSchema = z.strictObject({
  role: z.enum(MODEL_TEXT_ROLES),
  content: z.string().min(1).max(MODEL_TEXT_CONTENT_MAX_LENGTH),
});

export const generateTextInputSchema = z.strictObject({
  messages: z.array(modelTextMessageSchema).min(1).max(MODEL_TEXT_MAX_MESSAGES),
  maxOutputTokens: z
    .int()
    .min(MODEL_MAX_OUTPUT_TOKENS_MIN)
    .max(MODEL_MAX_OUTPUT_TOKENS_MAX)
    .optional(),
});

export const generateTextResultSchema = z.strictObject({
  text: z.string().min(1),
});
