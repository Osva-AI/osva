import { z } from "zod";

import {
  EVALUATION_CASE_OUTCOMES,
  EVALUATION_RUN_STATES,
  EVALUATION_RUN_TARGET_TYPES,
} from "../evaluation-suite.js";
import { evaluatorConfigSchema } from "./evaluation.js";
import { jsonValueSchema } from "./json-value.js";
import {
  agentVersionIdSchema,
  evaluationCaseIdSchema,
  evaluationCaseResultIdSchema,
  evaluationRunIdSchema,
  evaluationSuiteIdSchema,
  evaluationSuiteVersionIdSchema,
  runIdSchema,
  workflowVersionIdSchema,
  workspaceIdSchema,
} from "./ids.js";

export const createEvaluationSuiteRequestSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
});

export const evaluationSuiteResourceSchema = z.strictObject({
  id: evaluationSuiteIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const evaluationSuiteListResourceSchema = z.strictObject({
  items: z.array(evaluationSuiteResourceSchema),
});

export const evaluationCaseDefinitionSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1).optional(),
  input: jsonValueSchema,
  expected: jsonValueSchema.optional(),
  evaluator: evaluatorConfigSchema,
});

export const evaluationCaseResourceSchema = z.strictObject({
  id: evaluationCaseIdSchema,
  evaluationSuiteVersionId: evaluationSuiteVersionIdSchema,
  key: z.string().min(1),
  name: z.string().min(1).optional(),
  input: jsonValueSchema,
  expected: jsonValueSchema.optional(),
  evaluator: evaluatorConfigSchema,
  createdAt: z.string().min(1),
});

export const createEvaluationSuiteVersionRequestSchema = z.strictObject({
  cases: z.array(evaluationCaseDefinitionSchema).min(1),
});

export const evaluationSuiteVersionResourceSchema = z.strictObject({
  id: evaluationSuiteVersionIdSchema,
  evaluationSuiteId: evaluationSuiteIdSchema,
  version: z.number().int().min(1),
  cases: z.array(evaluationCaseResourceSchema),
  createdAt: z.string().min(1),
});

export const evaluationSuiteVersionListResourceSchema = z.strictObject({
  items: z.array(evaluationSuiteVersionResourceSchema),
});

export const createEvaluationRunRequestSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  evaluationSuiteVersionId: evaluationSuiteVersionIdSchema,
  targetType: z.enum(EVALUATION_RUN_TARGET_TYPES),
  targetVersionId: z.union([agentVersionIdSchema, workflowVersionIdSchema]),
});

export const evaluationRunResourceSchema = z.strictObject({
  id: evaluationRunIdSchema,
  workspaceId: workspaceIdSchema,
  evaluationSuiteVersionId: evaluationSuiteVersionIdSchema,
  targetType: z.enum(EVALUATION_RUN_TARGET_TYPES),
  targetVersionId: z.string().min(1),
  status: z.enum(EVALUATION_RUN_STATES),
  createdAt: z.string().min(1),
  startedAt: z.string().min(1).optional(),
  completedAt: z.string().min(1).optional(),
  cancelledAt: z.string().min(1).optional(),
});

export const evaluationRunSummarySchema = z.strictObject({
  totalCases: z.number().int().min(0),
  pendingCases: z.number().int().min(0),
  runningCases: z.number().int().min(0),
  completedCases: z.number().int().min(0),
  passedCases: z.number().int().min(0),
  failedCases: z.number().int().min(0),
  errorCases: z.number().int().min(0),
  passRate: z.number().min(0).max(1),
  durationMs: z.number().int().min(0).optional(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  pricedCostUsdMicros: z.number().int().min(0),
  unpricedModelCalls: z.number().int().min(0),
});

export const evaluationRunDetailResourceSchema =
  evaluationRunResourceSchema.extend({
    summary: evaluationRunSummarySchema,
  });

export const evaluationCaseResultResourceSchema = z.strictObject({
  id: evaluationCaseResultIdSchema,
  evaluationRunId: evaluationRunIdSchema,
  evaluationCaseId: evaluationCaseIdSchema,
  runId: runIdSchema,
  outcome: z.enum(EVALUATION_CASE_OUTCOMES),
  evaluatorResults: z.record(z.string(), z.unknown()),
  createdAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
});

export const evaluationCaseResultListResourceSchema = z.strictObject({
  items: z.array(evaluationCaseResultResourceSchema),
});
