import { z } from "zod";

import {
  EVALUATION_CASE_OUTCOMES,
  EVALUATION_RUN_STATES,
  EVALUATION_RUN_TARGET_TYPES,
} from "../evaluation-suite.js";
import { evaluatorConfigSchema } from "./evaluation.js";
import {
  evaluationQualityGatePolicySchema,
  evaluationRunQualityGateSchema,
} from "./evaluation-quality-gate.js";
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
import { utcIso8601TimestampSchema } from "./utc-instant.js";

export const createEvaluationSuiteRequestSchema = z.strictObject({
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
  evaluationSuiteVersionId: evaluationSuiteVersionIdSchema,
  targetType: z.enum(EVALUATION_RUN_TARGET_TYPES),
  targetVersionId: z.union([agentVersionIdSchema, workflowVersionIdSchema]),
  qualityGatePolicy: evaluationQualityGatePolicySchema.optional(),
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
  completionCoverage: z.number().min(0).max(1),
  validScoredCaseCount: z.number().int().min(0),
  qualityScore: z.number().min(0).max(1).optional(),
  durationMs: z.number().int().min(0).optional(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  pricedCostUsdMicros: z.number().int().min(0),
  unpricedModelCalls: z.number().int().min(0),
  usageMeasured: z.boolean(),
});

export const evaluationRunDetailResourceSchema =
  evaluationRunResourceSchema.extend({
    summary: evaluationRunSummarySchema,
    qualityGate: evaluationRunQualityGateSchema.optional(),
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

export const evaluationRunListCursorPayloadSchema = z.strictObject({
  createdAt: utcIso8601TimestampSchema,
  id: evaluationRunIdSchema,
});

export const listEvaluationRunsQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, "limit must be a positive integer")
    .optional(),
  cursor: z.string().min(1).optional(),
  evaluationSuiteId: evaluationSuiteIdSchema.optional(),
  evaluationSuiteVersionId: evaluationSuiteVersionIdSchema.optional(),
  agentVersionId: agentVersionIdSchema.optional(),
  status: z.enum(EVALUATION_RUN_STATES).optional(),
});

export const evaluationRunListResourceSchema = z.strictObject({
  items: z.array(evaluationRunResourceSchema),
  nextCursor: z.string().min(1).optional(),
});
