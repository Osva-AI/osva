import { createHash } from "node:crypto";

import type { EvaluationSuiteVersionId } from "@osva-ai/contracts";
import {
  A4_RAG_EVALUATOR_IMPLEMENTATION_VERSION,
  A4_RAG_PROMPT_TEMPLATE_VERSION,
  LLM_JUDGE_EVALUATOR_IMPLEMENTATION_VERSION,
  LLM_JUDGE_PROMPT_TEMPLATE_VERSION,
  type LlmJudgeEvaluatorConfig,
} from "@osva-ai/contracts";

import type { JudgeBackedEvaluatorConfig } from "../judge-backed-evaluator.js";

export function computeJudgeBackedRubricIdentity(input: {
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly config: JudgeBackedEvaluatorConfig;
  readonly resolvedMinPassingScore: number;
}): string {
  const implementationVersion =
    input.config.type === "LLM_JUDGE"
      ? LLM_JUDGE_EVALUATOR_IMPLEMENTATION_VERSION
      : A4_RAG_EVALUATOR_IMPLEMENTATION_VERSION;
  const promptTemplateVersion =
    input.config.type === "LLM_JUDGE"
      ? LLM_JUDGE_PROMPT_TEMPLATE_VERSION
      : A4_RAG_PROMPT_TEMPLATE_VERSION;

  const typeSpecific =
    input.config.type === "LLM_JUDGE"
      ? { rubric: input.config.rubric }
      : input.config.type === "RAG_FAITHFULNESS"
        ? {
            noEvaluableClaimsPolicy:
              input.config.noEvaluableClaimsPolicy ?? null,
          }
        : {};

  const payload = JSON.stringify({
    type: input.config.type,
    evaluationSuiteVersionId: input.evaluationSuiteVersionId,
    modelProfileVersionId: input.config.modelProfileVersionId,
    minPassingScore: input.resolvedMinPassingScore,
    maxOutputTokens: input.config.maxOutputTokens,
    instructions: input.config.instructions ?? null,
    promptTemplateVersion,
    implementationVersion,
    ...typeSpecific,
  });

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function implementationVersionForJudgeBacked(
  config: JudgeBackedEvaluatorConfig,
): string {
  return config.type === "LLM_JUDGE"
    ? LLM_JUDGE_EVALUATOR_IMPLEMENTATION_VERSION
    : A4_RAG_EVALUATOR_IMPLEMENTATION_VERSION;
}

export function promptTemplateVersionForJudgeBacked(
  config: JudgeBackedEvaluatorConfig,
): string {
  return config.type === "LLM_JUDGE"
    ? LLM_JUDGE_PROMPT_TEMPLATE_VERSION
    : A4_RAG_PROMPT_TEMPLATE_VERSION;
}

export function isLlmJudgeConfig(
  config: JudgeBackedEvaluatorConfig,
): config is LlmJudgeEvaluatorConfig {
  return config.type === "LLM_JUDGE";
}
