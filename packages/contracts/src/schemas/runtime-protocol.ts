import { z } from "zod";

import { MEMORY_ACCESS_MODES } from "../memory-gateway.js";
import {
  agentIdSchema,
  agentVersionIdSchema,
  evaluationCaseIdSchema,
  evaluationRunIdSchema,
  memoryNamespaceIdSchema,
  modelProfileVersionIdSchema,
  toolVersionIdSchema,
  runAttemptIdSchema,
  runIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import { agentRuntimeSchema } from "./agent-manifest.js";
import { toolGrantSchema } from "./tool.js";

const memoryNamespaceBindingSchema = z.strictObject({
  namespaceId: memoryNamespaceIdSchema,
  access: z.enum(MEMORY_ACCESS_MODES),
});

const executionEvaluationContextSchema = z.strictObject({
  evaluationRunId: evaluationRunIdSchema,
  evaluationCaseId: evaluationCaseIdSchema,
});

export const executionRequestSchema = z.strictObject({
  runId: runIdSchema,
  runAttemptId: runAttemptIdSchema,
  workspaceId: workspaceIdSchema,
  agentId: agentIdSchema,
  agentVersionId: agentVersionIdSchema,
  runtime: agentRuntimeSchema,
  input: z.unknown(),
  effectiveConfig: z.record(z.string(), z.unknown()),
  modelProfileVersionBindings: z.record(
    z.string(),
    modelProfileVersionIdSchema,
  ),
  toolVersionBindings: z.record(z.string(), toolVersionIdSchema),
  memoryNamespaceBindings: z.record(z.string(), memoryNamespaceBindingSchema),
  toolGrants: z.array(toolGrantSchema),
  timeoutMs: z.int().positive(),
  policyContext: z.record(z.string(), z.unknown()),
  evaluationContext: executionEvaluationContextSchema.optional(),
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
