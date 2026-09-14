import { z } from "zod";

import { jsonSchemaRecordSchema } from "./json-schema.js";
import { modelProfileVersionIdSchema } from "./ids.js";

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
