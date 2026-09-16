import { z } from "zod";

import { RUN_STEP_KINDS, RUN_STEP_STATUSES } from "../run-step.js";
import {
  modelProfileVersionIdSchema,
  runAttemptIdSchema,
  runIdSchema,
  runStepIdSchema,
  toolVersionIdSchema,
} from "./ids.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";

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
  estimatedCostUsdMicros: z.int().nonnegative().nullable().optional(),
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
  estimatedCostUsdMicros: z.int().nonnegative().nullable(),
  pricedModelCalls: z.int().nonnegative(),
  unpricedModelCalls: z.int().nonnegative(),
});
