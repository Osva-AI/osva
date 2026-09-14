import { z } from "zod";

import {
  agentVersionIdSchema,
  modelProfileVersionIdSchema,
  runAttemptIdSchema,
  runIdSchema,
} from "./ids.js";
import { toolGrantSchema } from "./tool.js";

export const executionRequestSchema = z.strictObject({
  runId: runIdSchema,
  runAttemptId: runAttemptIdSchema,
  agentVersionId: agentVersionIdSchema,
  input: z.unknown(),
  effectiveConfig: z.record(z.string(), z.unknown()),
  modelProfileVersionBindings: z.record(
    z.string(),
    modelProfileVersionIdSchema,
  ),
  toolGrants: z.array(toolGrantSchema),
  timeoutMs: z.int().positive(),
  policyContext: z.record(z.string(), z.unknown()),
});

const executionErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const executionSuccessSchema = z.strictObject({
  status: z.literal("succeeded"),
  output: z.unknown(),
});

export const executionFailureSchema = z.strictObject({
  status: z.literal("failed"),
  error: executionErrorSchema,
});

export const executionResultSchema = z.discriminatedUnion("status", [
  executionSuccessSchema,
  executionFailureSchema,
]);
