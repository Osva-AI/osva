import type { JsonValue } from "./json-value.js";
import type { ModelProfileVersionId } from "./ids.js";

export const DETERMINISTIC_EVALUATOR_IMPLEMENTATION_VERSION = "a1.0" as const;
export const LLM_JUDGE_EVALUATOR_IMPLEMENTATION_VERSION = "a3.0" as const;
export const LLM_JUDGE_PROMPT_TEMPLATE_VERSION = "a3.0" as const;

export const EVALUATOR_TYPES = [
  "JSON_EXACT_MATCH",
  "TEXT_EXACT_MATCH",
  "TOKEN_F1",
  "BLEU",
  "ROUGE_L",
  "JSON_VALID",
  "REQUIRED_CONCEPTS",
  "FORBIDDEN_CONCEPTS",
  "LLM_JUDGE",
  "RAG_FAITHFULNESS",
  "RAG_ANSWER_RELEVANCE",
  "RAG_CONTEXT_PRECISION",
  "RAG_CONTEXT_RECALL",
  "SEMANTIC_SIMILARITY",
] as const;

export type EvaluatorType = (typeof EVALUATOR_TYPES)[number];

export function isEvaluatorType(value: string): value is EvaluatorType {
  return (EVALUATOR_TYPES as readonly string[]).includes(value);
}

/** Direct (persisted) evaluations remain JSON_EXACT_MATCH-only. */
export const PERSISTED_DIRECT_EVALUATOR_TYPES = ["JSON_EXACT_MATCH"] as const;

export type PersistedDirectEvaluatorType =
  (typeof PERSISTED_DIRECT_EVALUATOR_TYPES)[number];

export interface JsonExactMatchEvaluatorConfig {
  readonly type: "JSON_EXACT_MATCH";
  readonly expected: JsonValue;
}

export interface TextExactMatchEvaluatorConfig {
  readonly type: "TEXT_EXACT_MATCH";
  readonly reference: string;
  readonly caseSensitive?: boolean;
  readonly trimWhitespace?: boolean;
}

export interface TokenF1EvaluatorConfig {
  readonly type: "TOKEN_F1";
  readonly reference: string;
  readonly minPassingScore?: number;
}

export interface BleuEvaluatorConfig {
  readonly type: "BLEU";
  readonly reference: string;
  readonly minPassingScore?: number;
}

export interface RougeLEvaluatorConfig {
  readonly type: "ROUGE_L";
  readonly reference: string;
  readonly minPassingScore?: number;
}

export interface JsonValidEvaluatorConfig {
  readonly type: "JSON_VALID";
}

export interface RequiredConceptsEvaluatorConfig {
  readonly type: "REQUIRED_CONCEPTS";
  readonly concepts: readonly string[];
  readonly minPassingScore?: number;
}

export interface ForbiddenConceptsEvaluatorConfig {
  readonly type: "FORBIDDEN_CONCEPTS";
  readonly concepts: readonly string[];
}

export interface LlmJudgeEvaluatorConfig {
  readonly type: "LLM_JUDGE";
  readonly rubric: string;
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly minPassingScore?: number;
  readonly maxOutputTokens?: number;
  readonly instructions?: string;
}

export interface JudgeBackedEvaluatorConfigBase {
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly minPassingScore?: number;
  readonly maxOutputTokens?: number;
  readonly instructions?: string;
}

export interface RagFaithfulnessEvaluatorConfig extends JudgeBackedEvaluatorConfigBase {
  readonly type: "RAG_FAITHFULNESS";
  readonly noEvaluableClaimsPolicy?: "ERROR" | "NOT_APPLICABLE";
}

export interface RagAnswerRelevanceEvaluatorConfig extends JudgeBackedEvaluatorConfigBase {
  readonly type: "RAG_ANSWER_RELEVANCE";
}

export interface RagContextPrecisionEvaluatorConfig extends JudgeBackedEvaluatorConfigBase {
  readonly type: "RAG_CONTEXT_PRECISION";
}

export interface RagContextRecallEvaluatorConfig extends JudgeBackedEvaluatorConfigBase {
  readonly type: "RAG_CONTEXT_RECALL";
}

export interface SemanticSimilarityEvaluatorConfig extends JudgeBackedEvaluatorConfigBase {
  readonly type: "SEMANTIC_SIMILARITY";
}

export type EvaluatorConfig =
  | JsonExactMatchEvaluatorConfig
  | TextExactMatchEvaluatorConfig
  | TokenF1EvaluatorConfig
  | BleuEvaluatorConfig
  | RougeLEvaluatorConfig
  | JsonValidEvaluatorConfig
  | RequiredConceptsEvaluatorConfig
  | ForbiddenConceptsEvaluatorConfig
  | LlmJudgeEvaluatorConfig
  | RagFaithfulnessEvaluatorConfig
  | RagAnswerRelevanceEvaluatorConfig
  | RagContextPrecisionEvaluatorConfig
  | RagContextRecallEvaluatorConfig
  | SemanticSimilarityEvaluatorConfig;

export const EVALUATOR_REFERENCE_TEXT_MAX_LENGTH = 100_000;
export const EVALUATOR_CONCEPT_MAX_LENGTH = 500;
export const EVALUATOR_CONCEPT_LIST_MAX_SIZE = 64;
export const EVALUATOR_RUN_OUTPUT_TEXT_MAX_LENGTH = 100_000;
export const EVALUATOR_ROUGE_L_MAX_TOKENS = 8_192;

export const EVALUATOR_LLM_JUDGE_RUBRIC_MAX_LENGTH = 32_000;
export const EVALUATOR_LLM_JUDGE_INSTRUCTIONS_MAX_LENGTH = 4_000;
export const DEFAULT_LLM_JUDGE_MIN_PASSING_SCORE = 0.7;
export const DEFAULT_LLM_JUDGE_MAX_OUTPUT_TOKENS = 512;
export const LLM_JUDGE_MAX_OUTPUT_TOKENS_MAX = 4_096;
export const LLM_JUDGE_MAX_OUTPUT_TOKENS_MIN = 64;

export const JUDGE_VERDICT_REASON_MAX_LENGTH = 4_000;
export const JUDGE_VERDICT_EVIDENCE_MAX_ITEMS = 16;
export const JUDGE_VERDICT_EVIDENCE_ITEM_MAX_LENGTH = 1_000;

export const EVALUATION_JUDGE_TASK_STATES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
] as const;

export type EvaluationJudgeTaskState =
  (typeof EVALUATION_JUDGE_TASK_STATES)[number];

export function isEvaluationJudgeTaskState(
  value: string,
): value is EvaluationJudgeTaskState {
  return (EVALUATION_JUDGE_TASK_STATES as readonly string[]).includes(value);
}

export const DEFAULT_EVALUATION_JUDGE_TASK_MAX_ATTEMPTS = 3;
export const DEFAULT_EVALUATION_JUDGE_RECOVERY_BATCH_LIMIT = 20;

/** Wall-clock lease for in-flight judge task execution (worker reclaim window). */
export const DEFAULT_EVALUATION_JUDGE_LEASE_MS = 120_000;

/** Reserved time after a model call for verdict persistence and parent reconciliation. */
export const EVALUATION_JUDGE_LEASE_PERSISTENCE_BUFFER_MS = 15_000;

/**
 * Model-call timeout must stay below lease minus persistence buffer (policy A).
 * Derived default when callers do not override modelCallTimeoutMs.
 */
export const DEFAULT_EVALUATION_JUDGE_MODEL_CALL_TIMEOUT_MS =
  DEFAULT_EVALUATION_JUDGE_LEASE_MS -
  EVALUATION_JUDGE_LEASE_PERSISTENCE_BUFFER_MS;

export const DEFAULT_EVALUATION_JUDGE_MAX_CONCURRENT_TASKS = 2;

export function resolveEvaluationJudgeModelCallTimeoutMs(input: {
  readonly leaseTtlMs: number;
  readonly modelCallTimeoutMs?: number;
}): number {
  const requested =
    input.modelCallTimeoutMs ?? DEFAULT_EVALUATION_JUDGE_MODEL_CALL_TIMEOUT_MS;
  const maxAllowed =
    input.leaseTtlMs - EVALUATION_JUDGE_LEASE_PERSISTENCE_BUFFER_MS;
  if (maxAllowed < 1_000) {
    throw new Error(
      `Evaluation judge lease ${String(input.leaseTtlMs)}ms is too short for persistence buffer.`,
    );
  }
  if (requested > maxAllowed) {
    throw new Error(
      `Judge model call timeout ${String(requested)}ms exceeds safe limit ${String(maxAllowed)}ms for lease ${String(input.leaseTtlMs)}ms.`,
    );
  }
  if (requested < 1_000) {
    throw new Error(
      `Judge model call timeout ${String(requested)}ms is below minimum 1000ms.`,
    );
  }
  return requested;
}
