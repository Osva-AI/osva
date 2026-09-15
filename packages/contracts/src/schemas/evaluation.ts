import { z } from "zod";

import { EVALUATOR_TYPES } from "../evaluation.js";
import { evaluationIdSchema, runAttemptIdSchema, runIdSchema } from "./ids.js";
import { jsonValueSchema } from "./json-value.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";

export const evaluatorTypeSchema = z.enum(EVALUATOR_TYPES);

export const jsonExactMatchEvaluatorSchema = z.strictObject({
  type: z.literal("JSON_EXACT_MATCH"),
  expected: jsonValueSchema,
});

export const evaluatorConfigSchema = jsonExactMatchEvaluatorSchema;

export const createEvaluationRequestSchema = z.strictObject({
  evaluator: evaluatorConfigSchema,
});

export const evaluationResourceSchema = z.strictObject({
  id: evaluationIdSchema,
  runId: runIdSchema,
  runAttemptId: runAttemptIdSchema,
  evaluatorType: evaluatorTypeSchema,
  expected: jsonValueSchema,
  passed: z.boolean(),
  score: z.number(),
  createdAt: utcIso8601TimestampSchema,
});

export const evaluationListResourceSchema = z.strictObject({
  evaluations: z.array(evaluationResourceSchema),
});
