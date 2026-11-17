import type {
  JsonValue,
  RagFaithfulnessEvaluatorConfig,
} from "@osva-ai/contracts";
import { A4_RAG_EVALUATOR_IMPLEMENTATION_VERSION } from "@osva-ai/contracts";

import type { JudgeBackedEvaluatorConfig } from "../judge-backed-evaluator.js";
import { buildLlmJudgePrompt } from "../llm-judge/prompt.js";
import {
  JUDGE_VERDICT_JSON_SCHEMA,
  parseJudgeVerdictJson,
} from "../llm-judge/verdict.js";
import { validateRagEvidence } from "./evidence.js";
import {
  buildAnswerRelevanceJudgePrompt,
  buildContextPrecisionJudgePrompt,
  buildContextRecallJudgePrompt,
  buildFaithfulnessJudgePrompt,
  buildSemanticSimilarityJudgePrompt,
} from "./prompts.js";
import { isLlmJudgeConfig } from "./rubric-identity.js";
import {
  parseContextPrecisionVerdictJson,
  parseContextRecallVerdictJson,
  parseFaithfulnessVerdictJson,
  parseRagScoreVerdictJson,
  RAG_CONTEXT_PRECISION_VERDICT_JSON_SCHEMA,
  RAG_CONTEXT_RECALL_VERDICT_JSON_SCHEMA,
  RAG_FAITHFULNESS_VERDICT_JSON_SCHEMA,
  RAG_SCORE_VERDICT_JSON_SCHEMA,
} from "./verdicts.js";

export interface JudgeMetricPlan {
  readonly prompt: string;
  readonly jsonSchema: object;
  readonly implementationVersion: string;
  readonly parseVerdict: (raw: string) =>
    | {
        readonly ok: true;
        readonly score: number;
        readonly reason: string;
        readonly evidence: readonly string[];
        readonly confidence?: number;
        readonly metricDetails?: Readonly<Record<string, unknown>>;
        readonly noEvaluableClaims?: boolean;
      }
    | { readonly ok: false; readonly errorCode: string };
}

export function buildJudgeMetricPlan(input: {
  readonly config: JudgeBackedEvaluatorConfig;
  readonly minPassingScore: number;
  readonly caseInput: JsonValue;
  readonly caseExpected: JsonValue | undefined;
  readonly targetOutput: JsonValue;
}):
  | { readonly ok: true; readonly plan: JudgeMetricPlan }
  | { readonly ok: false; readonly errorCode: string } {
  const evidenceResult = validateRagEvidence(
    input.config.type,
    input.caseInput,
    input.caseExpected,
    input.targetOutput,
  );
  if (!evidenceResult.ok) {
    return evidenceResult;
  }

  if (isLlmJudgeConfig(input.config)) {
    return {
      ok: true,
      plan: {
        prompt: buildLlmJudgePrompt({
          config: input.config,
          minPassingScore: input.minPassingScore,
          caseInput: input.caseInput,
          caseExpected: input.caseExpected,
          targetOutput: input.targetOutput,
        }),
        jsonSchema: JUDGE_VERDICT_JSON_SCHEMA,
        implementationVersion: "a3.0",
        parseVerdict: (raw) => {
          const parsed = parseJudgeVerdictJson(raw);
          if (!parsed.ok) {
            return parsed;
          }
          return {
            ok: true,
            score: parsed.verdict.score,
            reason: parsed.verdict.reason,
            evidence: parsed.verdict.evidence,
            ...(parsed.verdict.confidence === undefined
              ? {}
              : { confidence: parsed.verdict.confidence }),
          };
        },
      },
    };
  }

  const evidence = evidenceResult.evidence;
  const chunkIds = new Set(
    evidence.expected.context?.chunks.map((chunk) => chunk.id) ?? [],
  );
  const chunksByRank =
    evidence.expected.context?.chunks
      .slice()
      .sort((left, right) => left.rank - right.rank)
      .map((chunk) => chunk.id) ?? [];

  switch (input.config.type) {
    case "RAG_FAITHFULNESS": {
      const config = input.config as RagFaithfulnessEvaluatorConfig;
      return {
        ok: true,
        plan: {
          prompt: buildFaithfulnessJudgePrompt({ config, evidence }),
          jsonSchema: RAG_FAITHFULNESS_VERDICT_JSON_SCHEMA,
          implementationVersion: A4_RAG_EVALUATOR_IMPLEMENTATION_VERSION,
          parseVerdict: (raw) => {
            const parsed = parseFaithfulnessVerdictJson(raw, chunkIds);
            if (!parsed.ok) {
              return parsed;
            }
            if (parsed.noEvaluableClaims) {
              const policy = config.noEvaluableClaimsPolicy ?? "ERROR";
              return {
                ok: false,
                errorCode:
                  policy === "NOT_APPLICABLE"
                    ? "rag_not_applicable"
                    : "rag_no_evaluable_claims",
              };
            }
            return parsed;
          },
        },
      };
    }
    case "RAG_ANSWER_RELEVANCE":
      return {
        ok: true,
        plan: {
          prompt: buildAnswerRelevanceJudgePrompt({
            config: input.config,
            evidence,
            minPassingScore: input.minPassingScore,
          }),
          jsonSchema: RAG_SCORE_VERDICT_JSON_SCHEMA,
          implementationVersion: A4_RAG_EVALUATOR_IMPLEMENTATION_VERSION,
          parseVerdict: (raw) => {
            const parsed = parseRagScoreVerdictJson(raw);
            if (!parsed.ok) {
              return parsed;
            }
            return {
              ok: true,
              score: parsed.score,
              reason: parsed.reason,
              evidence: parsed.evidence,
              ...(parsed.confidence === undefined
                ? {}
                : { confidence: parsed.confidence }),
            };
          },
        },
      };
    case "RAG_CONTEXT_PRECISION":
      return {
        ok: true,
        plan: {
          prompt: buildContextPrecisionJudgePrompt({
            config: input.config,
            evidence,
          }),
          jsonSchema: RAG_CONTEXT_PRECISION_VERDICT_JSON_SCHEMA,
          implementationVersion: A4_RAG_EVALUATOR_IMPLEMENTATION_VERSION,
          parseVerdict: (raw) => {
            const parsed = parseContextPrecisionVerdictJson(raw, chunksByRank);
            return parsed;
          },
        },
      };
    case "RAG_CONTEXT_RECALL": {
      const expectedFactIds =
        evidence.expected.referenceFacts?.map((fact) => fact.id) ?? [];
      return {
        ok: true,
        plan: {
          prompt: buildContextRecallJudgePrompt({
            config: input.config,
            evidence,
          }),
          jsonSchema: RAG_CONTEXT_RECALL_VERDICT_JSON_SCHEMA,
          implementationVersion: A4_RAG_EVALUATOR_IMPLEMENTATION_VERSION,
          parseVerdict: (raw) =>
            parseContextRecallVerdictJson(raw, chunkIds, expectedFactIds),
        },
      };
    }
    case "SEMANTIC_SIMILARITY":
      return {
        ok: true,
        plan: {
          prompt: buildSemanticSimilarityJudgePrompt({
            config: input.config,
            evidence,
            minPassingScore: input.minPassingScore,
          }),
          jsonSchema: RAG_SCORE_VERDICT_JSON_SCHEMA,
          implementationVersion: A4_RAG_EVALUATOR_IMPLEMENTATION_VERSION,
          parseVerdict: (raw) => {
            const parsed = parseRagScoreVerdictJson(raw);
            if (!parsed.ok) {
              return parsed;
            }
            return {
              ok: true,
              score: parsed.score,
              reason: parsed.reason,
              evidence: parsed.evidence,
              ...(parsed.confidence === undefined
                ? {}
                : { confidence: parsed.confidence }),
            };
          },
        },
      };
    default: {
      const exhaustive: never = input.config;
      return { ok: false, errorCode: `unsupported_evaluator:${exhaustive}` };
    }
  }
}
