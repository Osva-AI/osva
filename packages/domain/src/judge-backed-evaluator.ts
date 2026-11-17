import {
  safeParseEvaluatorConfig,
  isJudgeBackedEvaluatorType,
  type EvaluatorConfig,
  type LlmJudgeEvaluatorConfig,
  type RagAnswerRelevanceEvaluatorConfig,
  type RagContextPrecisionEvaluatorConfig,
  type RagContextRecallEvaluatorConfig,
  type RagFaithfulnessEvaluatorConfig,
  type SemanticSimilarityEvaluatorConfig,
  DEFAULT_LLM_JUDGE_MAX_OUTPUT_TOKENS,
  DEFAULT_LLM_JUDGE_MIN_PASSING_SCORE,
} from "@osva-ai/contracts";

export type JudgeBackedEvaluatorConfig =
  | LlmJudgeEvaluatorConfig
  | RagFaithfulnessEvaluatorConfig
  | RagAnswerRelevanceEvaluatorConfig
  | RagContextPrecisionEvaluatorConfig
  | RagContextRecallEvaluatorConfig
  | SemanticSimilarityEvaluatorConfig;

export function isJudgeBackedEvaluatorConfig(
  config: EvaluatorConfig,
): config is JudgeBackedEvaluatorConfig {
  return isJudgeBackedEvaluatorType(config.type);
}

export function parseJudgeBackedEvaluatorConfig(
  evaluator: unknown,
): JudgeBackedEvaluatorConfig | null {
  const parsed = safeParseEvaluatorConfig(evaluator);
  if (!parsed.success || !isJudgeBackedEvaluatorConfig(parsed.data)) {
    return null;
  }
  return parsed.data;
}

export function resolvedJudgeBackedMinPassingScore(
  config: JudgeBackedEvaluatorConfig,
): number {
  return config.minPassingScore ?? DEFAULT_LLM_JUDGE_MIN_PASSING_SCORE;
}

export function resolvedJudgeBackedMaxOutputTokens(
  config: JudgeBackedEvaluatorConfig,
): number {
  return config.maxOutputTokens ?? DEFAULT_LLM_JUDGE_MAX_OUTPUT_TOKENS;
}
