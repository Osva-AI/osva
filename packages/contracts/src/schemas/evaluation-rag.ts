import { z } from "zod";

import {
  EVALUATION_CASE_EXPECTED_SCHEMA_VERSION,
  EVALUATION_CONTEXT_AGGREGATE_TEXT_MAX_BYTES,
  EVALUATION_CONTEXT_CHUNK_ID_MAX_LENGTH,
  EVALUATION_CONTEXT_CHUNK_TEXT_MAX_LENGTH,
  EVALUATION_CONTEXT_MAX_CHUNKS,
  EVALUATION_CONTEXT_SOURCE_ID_MAX_LENGTH,
  EVALUATION_REFERENCE_FACT_ID_MAX_LENGTH,
  EVALUATION_REFERENCE_FACT_MAX_COUNT,
  EVALUATION_REFERENCE_FACT_STATEMENT_MAX_LENGTH,
} from "../evaluation-rag.js";
import {
  EVALUATOR_LLM_JUDGE_INSTRUCTIONS_MAX_LENGTH,
  EVALUATOR_REFERENCE_TEXT_MAX_LENGTH,
  LLM_JUDGE_MAX_OUTPUT_TOKENS_MAX,
  LLM_JUDGE_MAX_OUTPUT_TOKENS_MIN,
} from "../evaluation.js";
import { modelProfileVersionIdSchema } from "./ids.js";

const finiteUnitIntervalSchema = z
  .number()
  .min(0)
  .max(1)
  .refine((value) => Number.isFinite(value), {
    message: "threshold must be a finite number in [0, 1]",
  });

export const evaluationContextChunkSchema = z.strictObject({
  id: z.string().min(1).max(EVALUATION_CONTEXT_CHUNK_ID_MAX_LENGTH),
  text: z.string().min(1).max(EVALUATION_CONTEXT_CHUNK_TEXT_MAX_LENGTH),
  rank: z.int().min(1).max(EVALUATION_CONTEXT_MAX_CHUNKS),
  sourceId: z
    .string()
    .min(1)
    .max(EVALUATION_CONTEXT_SOURCE_ID_MAX_LENGTH)
    .optional(),
});

export const evaluationReferenceFactSchema = z.strictObject({
  id: z.string().min(1).max(EVALUATION_REFERENCE_FACT_ID_MAX_LENGTH),
  statement: z
    .string()
    .min(1)
    .max(EVALUATION_REFERENCE_FACT_STATEMENT_MAX_LENGTH),
});

export const evaluationCaseExpectedV1Schema = z
  .strictObject({
    schemaVersion: z.literal(EVALUATION_CASE_EXPECTED_SCHEMA_VERSION),
    context: z
      .strictObject({
        chunks: z
          .array(evaluationContextChunkSchema)
          .min(1)
          .max(EVALUATION_CONTEXT_MAX_CHUNKS),
      })
      .optional(),
    referenceAnswer: z
      .string()
      .min(1)
      .max(EVALUATOR_REFERENCE_TEXT_MAX_LENGTH)
      .optional(),
    referenceFacts: z
      .array(evaluationReferenceFactSchema)
      .min(1)
      .max(EVALUATION_REFERENCE_FACT_MAX_COUNT)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.context === undefined) {
      return;
    }
    const ranks = value.context.chunks.map((chunk) => chunk.rank);
    const uniqueRanks = new Set(ranks);
    if (uniqueRanks.size !== ranks.length) {
      ctx.addIssue({
        code: "custom",
        message: "context chunk ranks must be unique",
        path: ["context", "chunks"],
      });
    }
    const ids = value.context.chunks.map((c) => c.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "context chunk ids must be unique",
        path: ["context", "chunks"],
      });
    }
    const bytes = value.context.chunks.reduce(
      (sum, chunk) => sum + [...chunk.text].length,
      0,
    );
    if (bytes > EVALUATION_CONTEXT_AGGREGATE_TEXT_MAX_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: "aggregate context text exceeds size limit",
        path: ["context", "chunks"],
      });
    }
  });

export const judgeBackedEvaluatorBaseSchema = {
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
};

export const ragFaithfulnessEvaluatorSchema = z.strictObject({
  type: z.literal("RAG_FAITHFULNESS"),
  ...judgeBackedEvaluatorBaseSchema,
  noEvaluableClaimsPolicy: z.enum(["ERROR", "NOT_APPLICABLE"]).optional(),
});

export const ragAnswerRelevanceEvaluatorSchema = z.strictObject({
  type: z.literal("RAG_ANSWER_RELEVANCE"),
  ...judgeBackedEvaluatorBaseSchema,
});

export const ragContextPrecisionEvaluatorSchema = z.strictObject({
  type: z.literal("RAG_CONTEXT_PRECISION"),
  ...judgeBackedEvaluatorBaseSchema,
});

export const ragContextRecallEvaluatorSchema = z.strictObject({
  type: z.literal("RAG_CONTEXT_RECALL"),
  ...judgeBackedEvaluatorBaseSchema,
});

export const semanticSimilarityEvaluatorSchema = z.strictObject({
  type: z.literal("SEMANTIC_SIMILARITY"),
  ...judgeBackedEvaluatorBaseSchema,
});

export function safeParseEvaluationCaseExpectedV1(value: unknown) {
  return evaluationCaseExpectedV1Schema.safeParse(value);
}
