import { z } from "zod";

import {
  EVALUATOR_CONCEPT_LIST_MAX_SIZE,
  EVALUATOR_CONCEPT_MAX_LENGTH,
  EVALUATOR_LLM_JUDGE_INSTRUCTIONS_MAX_LENGTH,
  EVALUATOR_LLM_JUDGE_RUBRIC_MAX_LENGTH,
  EVALUATOR_REFERENCE_TEXT_MAX_LENGTH,
  EVALUATOR_TYPES,
  LLM_JUDGE_MAX_OUTPUT_TOKENS_MAX,
  LLM_JUDGE_MAX_OUTPUT_TOKENS_MIN,
} from "../evaluation.js";
import {
  evaluationIdSchema,
  modelProfileVersionIdSchema,
  runAttemptIdSchema,
  runIdSchema,
} from "./ids.js";
import { jsonValueSchema } from "./json-value.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";
import {
  ragAnswerRelevanceEvaluatorSchema,
  ragContextPrecisionEvaluatorSchema,
  ragContextRecallEvaluatorSchema,
  ragFaithfulnessEvaluatorSchema,
  semanticSimilarityEvaluatorSchema,
} from "./evaluation-rag.js";

const finiteUnitIntervalSchema = z
  .number()
  .min(0)
  .max(1)
  .refine((value) => Number.isFinite(value), {
    message: "threshold must be a finite number in [0, 1]",
  });

const boundedReferenceTextSchema = z
  .string()
  .min(1)
  .max(EVALUATOR_REFERENCE_TEXT_MAX_LENGTH);

const boundedConceptSchema = z
  .string()
  .min(1)
  .max(EVALUATOR_CONCEPT_MAX_LENGTH);

const boundedConceptListSchema = z
  .array(boundedConceptSchema)
  .min(1)
  .max(EVALUATOR_CONCEPT_LIST_MAX_SIZE);

export const evaluatorTypeSchema = z.enum(EVALUATOR_TYPES);

export const jsonExactMatchEvaluatorSchema = z.strictObject({
  type: z.literal("JSON_EXACT_MATCH"),
  expected: jsonValueSchema,
});

export const textExactMatchEvaluatorSchema = z.strictObject({
  type: z.literal("TEXT_EXACT_MATCH"),
  reference: boundedReferenceTextSchema,
  caseSensitive: z.boolean().optional(),
  trimWhitespace: z.boolean().optional(),
});

export const tokenF1EvaluatorSchema = z.strictObject({
  type: z.literal("TOKEN_F1"),
  reference: boundedReferenceTextSchema,
  minPassingScore: finiteUnitIntervalSchema.optional(),
});

export const bleuEvaluatorSchema = z.strictObject({
  type: z.literal("BLEU"),
  reference: boundedReferenceTextSchema,
  minPassingScore: finiteUnitIntervalSchema.optional(),
});

export const rougeLEvaluatorSchema = z.strictObject({
  type: z.literal("ROUGE_L"),
  reference: boundedReferenceTextSchema,
  minPassingScore: finiteUnitIntervalSchema.optional(),
});

export const jsonValidEvaluatorSchema = z.strictObject({
  type: z.literal("JSON_VALID"),
});

export const requiredConceptsEvaluatorSchema = z.strictObject({
  type: z.literal("REQUIRED_CONCEPTS"),
  concepts: boundedConceptListSchema,
  minPassingScore: finiteUnitIntervalSchema.optional(),
});

export const forbiddenConceptsEvaluatorSchema = z.strictObject({
  type: z.literal("FORBIDDEN_CONCEPTS"),
  concepts: boundedConceptListSchema,
});

export const llmJudgeEvaluatorSchema = z.strictObject({
  type: z.literal("LLM_JUDGE"),
  rubric: z.string().min(1).max(EVALUATOR_LLM_JUDGE_RUBRIC_MAX_LENGTH),
  modelProfileVersionId: modelProfileVersionIdSchema,
  minPassingScore: finiteUnitIntervalSchema.optional(),
  maxOutputTokens: z
    .int()
    .min(LLM_JUDGE_MAX_OUTPUT_TOKENS_MIN)
    .max(LLM_JUDGE_MAX_OUTPUT_TOKENS_MAX)
    .optional(),
  instructions: z
    .string()
    .min(1)
    .max(EVALUATOR_LLM_JUDGE_INSTRUCTIONS_MAX_LENGTH)
    .optional(),
});

export const evaluatorConfigSchema = z.discriminatedUnion("type", [
  jsonExactMatchEvaluatorSchema,
  textExactMatchEvaluatorSchema,
  tokenF1EvaluatorSchema,
  bleuEvaluatorSchema,
  rougeLEvaluatorSchema,
  jsonValidEvaluatorSchema,
  requiredConceptsEvaluatorSchema,
  forbiddenConceptsEvaluatorSchema,
  llmJudgeEvaluatorSchema,
  ragFaithfulnessEvaluatorSchema,
  ragAnswerRelevanceEvaluatorSchema,
  ragContextPrecisionEvaluatorSchema,
  ragContextRecallEvaluatorSchema,
  semanticSimilarityEvaluatorSchema,
]);

export const jsonExactMatchEvaluatorConfigSchema =
  jsonExactMatchEvaluatorSchema;

export const createEvaluationRequestSchema = z.strictObject({
  evaluator: jsonExactMatchEvaluatorSchema,
});

export const evaluationResourceSchema = z.strictObject({
  id: evaluationIdSchema,
  runId: runIdSchema,
  runAttemptId: runAttemptIdSchema,
  evaluatorType: z.literal("JSON_EXACT_MATCH"),
  expected: jsonValueSchema,
  passed: z.boolean(),
  score: z.number(),
  createdAt: utcIso8601TimestampSchema,
});

export const evaluationListResourceSchema = z.strictObject({
  evaluations: z.array(evaluationResourceSchema),
});
