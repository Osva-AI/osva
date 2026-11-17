import { createHash } from "node:crypto";

import type {
  EvaluationSuiteVersionId,
  LlmJudgeEvaluatorConfig,
} from "@osva-ai/contracts";
import {
  LLM_JUDGE_EVALUATOR_IMPLEMENTATION_VERSION,
  LLM_JUDGE_PROMPT_TEMPLATE_VERSION,
} from "@osva-ai/contracts";

export interface LlmJudgeRubricIdentityInput {
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly config: LlmJudgeEvaluatorConfig;
  readonly resolvedMinPassingScore: number;
}

export function computeLlmJudgeRubricIdentity(
  input: LlmJudgeRubricIdentityInput,
): string {
  const payload = JSON.stringify({
    evaluationSuiteVersionId: input.evaluationSuiteVersionId,
    rubric: input.config.rubric,
    modelProfileVersionId: input.config.modelProfileVersionId,
    minPassingScore: input.resolvedMinPassingScore,
    maxOutputTokens: input.config.maxOutputTokens,
    instructions: input.config.instructions ?? null,
    promptTemplateVersion: LLM_JUDGE_PROMPT_TEMPLATE_VERSION,
    implementationVersion: LLM_JUDGE_EVALUATOR_IMPLEMENTATION_VERSION,
  });

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function resolvedLlmJudgeMinPassingScore(
  config: LlmJudgeEvaluatorConfig,
): number {
  return config.minPassingScore ?? 0.7;
}

export function resolvedLlmJudgeMaxOutputTokens(
  config: LlmJudgeEvaluatorConfig,
): number {
  return config.maxOutputTokens ?? 512;
}
