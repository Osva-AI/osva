import { z } from "zod";

import { INFERENCE_MODEL_INVOCATION_SOURCES } from "../inference-cache.js";
import { RUN_STEP_KINDS, RUN_STEP_STATUSES } from "../run-step.js";
import {
  modelProfileVersionIdSchema,
  runAttemptIdSchema,
  runIdSchema,
  runStepIdSchema,
  toolVersionIdSchema,
} from "./ids.js";
import { MODEL_PROVIDER_MODEL_ID_MAX_LENGTH } from "../model-gateway.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";

const providerReportedModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(MODEL_PROVIDER_MODEL_ID_MAX_LENGTH);
const providerRequestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);

export const runStepKindSchema = z.enum(RUN_STEP_KINDS);
export const runStepStatusSchema = z.enum(RUN_STEP_STATUSES);

export const runStepResourceSchema = z.strictObject({
  id: runStepIdSchema,
  runId: runIdSchema,
  runAttemptId: runAttemptIdSchema,
  kind: runStepKindSchema,
  bindingName: z.string().min(1),
  status: runStepStatusSchema,
  startedAt: utcIso8601TimestampSchema,
  completedAt: utcIso8601TimestampSchema.optional(),
  modelProfileVersionId: modelProfileVersionIdSchema.optional(),
  toolVersionId: toolVersionIdSchema.optional(),
  inputTokens: z.int().nonnegative().optional(),
  outputTokens: z.int().nonnegative().optional(),
  totalTokens: z.int().nonnegative().optional(),
  cachedInputTokens: z.int().nonnegative().optional(),
  cacheWriteInputTokens: z.int().nonnegative().optional(),
  usageIncomplete: z.boolean().optional(),
  providerReportedModelId: providerReportedModelIdSchema.optional(),
  providerRequestId: providerRequestIdSchema.optional(),
  estimatedCostUsdMicros: z.int().nonnegative().nullable().optional(),
  modelInvocationSource: z.enum(INFERENCE_MODEL_INVOCATION_SOURCES).optional(),
  estimatedAvoidedCostUsdMicros: z.int().nonnegative().nullable().optional(),
  errorCode: z.string().min(1).optional(),
});

export const runStepListCursorPayloadSchema = z.strictObject({
  startedAt: utcIso8601TimestampSchema,
  id: runStepIdSchema,
});

export const listRunStepsQuerySchema = z.strictObject({
  limit: z.string().regex(/^\d+$/).optional(),
  cursor: z.string().min(1).optional(),
});

export const runStepListResourceSchema = z.strictObject({
  steps: z.array(runStepResourceSchema),
  nextCursor: z.string().min(1).optional(),
});

export const runAttemptUsageResourceSchema = z.strictObject({
  modelCalls: z.int().nonnegative(),
  toolCalls: z.int().nonnegative(),
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  totalTokens: z.int().nonnegative(),
  cachedInputTokens: z.int().nonnegative(),
  cacheWriteInputTokens: z.int().nonnegative(),
  estimatedCostUsdMicros: z.int().nonnegative().nullable(),
  pricedModelCalls: z.int().nonnegative(),
  unpricedModelCalls: z.int().nonnegative(),
});
