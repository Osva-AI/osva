export const A4_RAG_EVALUATOR_IMPLEMENTATION_VERSION = "a4.0" as const;
export const A4_RAG_PROMPT_TEMPLATE_VERSION = "a4.0" as const;

export const EVALUATION_CASE_EXPECTED_SCHEMA_VERSION = "a4.0" as const;
export const EVALUATION_CASE_EXPECTED_FORMAT =
  "evaluation-case-expected-v1" as const;

export const JUDGE_BACKED_EVALUATOR_TYPES = [
  "LLM_JUDGE",
  "RAG_FAITHFULNESS",
  "RAG_ANSWER_RELEVANCE",
  "RAG_CONTEXT_PRECISION",
  "RAG_CONTEXT_RECALL",
  "SEMANTIC_SIMILARITY",
] as const;

export type JudgeBackedEvaluatorType =
  (typeof JUDGE_BACKED_EVALUATOR_TYPES)[number];

export function isJudgeBackedEvaluatorType(
  value: string,
): value is JudgeBackedEvaluatorType {
  return (JUDGE_BACKED_EVALUATOR_TYPES as readonly string[]).includes(value);
}

export const RAG_EVALUATOR_TYPES = [
  "RAG_FAITHFULNESS",
  "RAG_ANSWER_RELEVANCE",
  "RAG_CONTEXT_PRECISION",
  "RAG_CONTEXT_RECALL",
  "SEMANTIC_SIMILARITY",
] as const;

export type RagEvaluatorType = (typeof RAG_EVALUATOR_TYPES)[number];

export function isRagEvaluatorType(value: string): value is RagEvaluatorType {
  return (RAG_EVALUATOR_TYPES as readonly string[]).includes(value);
}

export const EVALUATION_CONTEXT_CHUNK_ID_MAX_LENGTH = 128;
export const EVALUATION_CONTEXT_SOURCE_ID_MAX_LENGTH = 128;
export const EVALUATION_CONTEXT_CHUNK_TEXT_MAX_LENGTH = 8_000;
export const EVALUATION_CONTEXT_MAX_CHUNKS = 32;
export const EVALUATION_CONTEXT_AGGREGATE_TEXT_MAX_BYTES = 96_000;

export const EVALUATION_REFERENCE_FACT_ID_MAX_LENGTH = 64;
export const EVALUATION_REFERENCE_FACT_STATEMENT_MAX_LENGTH = 2_000;
export const EVALUATION_REFERENCE_FACT_MAX_COUNT = 64;

export const RAG_EVALUATOR_MAX_CLAIMS = 64;
export const RAG_EVALUATOR_CLAIM_ID_MAX_LENGTH = 64;
export const RAG_EVALUATOR_CLAIM_STATEMENT_MAX_LENGTH = 2_000;
export const RAG_EVALUATOR_CLAIM_EXPLANATION_MAX_LENGTH = 1_000;

export const RAG_CONTEXT_CHUNK_TEXT_MAX_BYTES =
  EVALUATION_CONTEXT_CHUNK_TEXT_MAX_LENGTH;
export const RAG_CONTEXT_CHUNK_IDS_MAX = EVALUATION_CONTEXT_MAX_CHUNKS;
export const RAG_CONTEXT_AGGREGATE_TEXT_MAX_BYTES =
  EVALUATION_CONTEXT_AGGREGATE_TEXT_MAX_BYTES;

export const RAG_EVALUATOR_BOUNDS = {
  maxClaims: RAG_EVALUATOR_MAX_CLAIMS,
  claimIdMaxLength: RAG_EVALUATOR_CLAIM_ID_MAX_LENGTH,
  claimStatementMaxLength: RAG_EVALUATOR_CLAIM_STATEMENT_MAX_LENGTH,
  claimExplanationMaxLength: RAG_EVALUATOR_CLAIM_EXPLANATION_MAX_LENGTH,
  maxContextChunks: EVALUATION_CONTEXT_MAX_CHUNKS,
  maxReferenceFacts: EVALUATION_REFERENCE_FACT_MAX_COUNT,
} as const;

export interface EvaluationContextChunkV1 {
  readonly id: string;
  readonly text: string;
  readonly rank: number;
  readonly sourceId?: string;
}

export interface EvaluationReferenceFactV1 {
  readonly id: string;
  readonly statement: string;
}

export interface EvaluationCaseExpectedV1 {
  readonly schemaVersion: typeof EVALUATION_CASE_EXPECTED_SCHEMA_VERSION;
  readonly context?: {
    readonly chunks: readonly EvaluationContextChunkV1[];
  };
  readonly referenceAnswer?: string;
  readonly referenceFacts?: readonly EvaluationReferenceFactV1[];
}
