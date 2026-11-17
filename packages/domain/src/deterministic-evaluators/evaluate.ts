import {
  DETERMINISTIC_EVALUATOR_IMPLEMENTATION_VERSION,
  EVALUATOR_ROUGE_L_MAX_TOKENS,
  safeParseEvaluatorConfig,
  type EvaluatorConfig,
  type JsonValue,
} from "@osva-ai/contracts";

import { jsonValuesEqual } from "../json-equality.js";
import {
  exactMatchText,
  rougeLScore,
  sentenceBleuScore,
  tokenF1Score,
  tokenizeForMetrics,
  clampUnitInterval,
} from "./metrics.js";
import {
  assertCanonicalRunOutput,
  outputTextFromJsonValue,
  parseJsonDocumentFromText,
} from "./output.js";
import type {
  DeterministicEvaluationCaseOutcome,
  DeterministicEvaluatorCompletedResult,
  DeterministicEvaluatorErrorResult,
  DeterministicEvaluatorResult,
} from "./types.js";

const DEFAULT_MIN_PASSING_SCORE = 0.5;
const DEFAULT_REQUIRED_CONCEPTS_MIN_SCORE = 1;

function errorResult(
  type: string,
  errorCode: string,
  status: "ERROR" | "INVALID_CONFIG" = "ERROR",
): DeterministicEvaluatorErrorResult {
  return {
    type,
    status,
    errorCode,
    implementationVersion: DETERMINISTIC_EVALUATOR_IMPLEMENTATION_VERSION,
  };
}

function completedResult(
  config: EvaluatorConfig,
  score: number,
  passed: boolean,
  extra?: Partial<
    Pick<
      DeterministicEvaluatorCompletedResult,
      | "minPassingScore"
      | "matchedConceptCount"
      | "requiredConceptCount"
      | "forbiddenConceptHitCount"
    >
  >,
): DeterministicEvaluatorCompletedResult {
  return {
    type: config.type,
    status: "COMPLETED",
    score: clampUnitInterval(score),
    passed,
    implementationVersion: DETERMINISTIC_EVALUATOR_IMPLEMENTATION_VERSION,
    ...extra,
  };
}

function resolveReferenceText(
  config: EvaluatorConfig,
  caseExpected: JsonValue | undefined,
): string | undefined {
  if ("reference" in config && typeof config.reference === "string") {
    return config.reference;
  }
  if (caseExpected !== undefined && typeof caseExpected === "string") {
    return caseExpected;
  }
  return undefined;
}

function threshold(configMin: number | undefined): number {
  return configMin ?? DEFAULT_MIN_PASSING_SCORE;
}

function normalizeConceptForMatch(concept: string): string {
  return concept.trim().toLowerCase();
}

function normalizeOutputForConceptMatch(text: string): string {
  return text.toLowerCase();
}

function caseOutcomeFromResult(
  result: DeterministicEvaluatorResult,
): DeterministicEvaluationCaseOutcome {
  if (result.status !== "COMPLETED") {
    return {
      outcome: "ERROR",
      evaluatorResults: { ...result },
    };
  }
  return {
    outcome: result.passed ? "PASS" : "FAIL",
    evaluatorResults: { ...result },
  };
}

export function evaluateDeterministicEvaluator(
  rawConfig: unknown,
  output: unknown,
  caseExpected: JsonValue | undefined,
): DeterministicEvaluationCaseOutcome {
  const parsed = safeParseEvaluatorConfig(rawConfig);
  if (!parsed.success) {
    const type =
      typeof rawConfig === "object" &&
      rawConfig !== null &&
      "type" in rawConfig &&
      typeof (rawConfig as { type: unknown }).type === "string"
        ? (rawConfig as { type: string }).type
        : "UNKNOWN";
    return caseOutcomeFromResult(
      errorResult(type, "invalid_evaluator_config", "INVALID_CONFIG"),
    );
  }

  const config = parsed.data;
  return caseOutcomeFromResult(runEvaluator(config, output, caseExpected));
}

function runEvaluator(
  config: EvaluatorConfig,
  output: unknown,
  caseExpected: JsonValue | undefined,
): DeterministicEvaluatorResult {
  if (config.type === "JSON_EXACT_MATCH") {
    if (!assertCanonicalRunOutput(output)) {
      return errorResult(config.type, "invalid_output");
    }
    const expectedValue = config.expected ?? caseExpected;
    if (expectedValue === undefined) {
      return errorResult(config.type, "missing_expected_value");
    }
    const passed = jsonValuesEqual(output, expectedValue);
    return completedResult(config, passed ? 1 : 0, passed);
  }

  if (!assertCanonicalRunOutput(output)) {
    return errorResult(config.type, "invalid_output");
  }

  switch (config.type) {
    case "TEXT_EXACT_MATCH": {
      const reference =
        resolveReferenceText(config, caseExpected) ?? config.reference;
      const candidate = outputTextFromJsonValue(output);
      if (!candidate.ok) {
        return errorResult(config.type, "incompatible_output_type");
      }
      const caseSensitive = config.caseSensitive ?? false;
      const trimWhitespace = config.trimWhitespace ?? true;
      const passed = exactMatchText(
        candidate.text,
        reference,
        caseSensitive,
        trimWhitespace,
      );
      return completedResult(config, passed ? 1 : 0, passed);
    }
    case "TOKEN_F1":
    case "BLEU":
    case "ROUGE_L": {
      const reference = resolveReferenceText(config, caseExpected);
      if (reference === undefined || reference.trim().length === 0) {
        return errorResult(config.type, "missing_reference");
      }
      const candidate = outputTextFromJsonValue(output);
      if (!candidate.ok) {
        return errorResult(config.type, "incompatible_output_type");
      }
      let score: number;
      if (config.type === "TOKEN_F1") {
        score = tokenF1Score(candidate.text, reference);
      } else if (config.type === "BLEU") {
        score = sentenceBleuScore(candidate.text, reference);
      } else {
        const candidateTokens = tokenizeForMetrics(candidate.text);
        const referenceTokens = tokenizeForMetrics(reference);
        const tokenCount = candidateTokens.length + referenceTokens.length;
        if (tokenCount > EVALUATOR_ROUGE_L_MAX_TOKENS) {
          return errorResult(config.type, "input_too_large");
        }
        score = rougeLScore(candidate.text, reference);
      }
      const minPassingScore = threshold(config.minPassingScore);
      const passed = score >= minPassingScore;
      return completedResult(config, score, passed, { minPassingScore });
    }
    case "JSON_VALID": {
      if (typeof output === "string") {
        const valid = parseJsonDocumentFromText(output);
        return completedResult(config, valid ? 1 : 0, valid);
      }
      return completedResult(config, 1, true);
    }
    case "REQUIRED_CONCEPTS": {
      const candidate = outputTextFromJsonValue(output);
      if (!candidate.ok) {
        return errorResult(config.type, "incompatible_output_type");
      }
      const haystack = normalizeOutputForConceptMatch(candidate.text);
      let matched = 0;
      for (const concept of config.concepts) {
        const needle = normalizeConceptForMatch(concept);
        if (needle.length === 0) {
          continue;
        }
        if (haystack.includes(needle)) {
          matched += 1;
        }
      }
      const required = config.concepts.length;
      const score = required === 0 ? 0 : matched / required;
      const minPassingScore =
        config.minPassingScore ?? DEFAULT_REQUIRED_CONCEPTS_MIN_SCORE;
      const passed = score >= minPassingScore;
      return completedResult(config, score, passed, {
        minPassingScore,
        matchedConceptCount: matched,
        requiredConceptCount: required,
      });
    }
    case "FORBIDDEN_CONCEPTS": {
      const candidate = outputTextFromJsonValue(output);
      if (!candidate.ok) {
        return errorResult(config.type, "incompatible_output_type");
      }
      const haystack = normalizeOutputForConceptMatch(candidate.text);
      let hits = 0;
      for (const concept of config.concepts) {
        const needle = normalizeConceptForMatch(concept);
        if (needle.length > 0 && haystack.includes(needle)) {
          hits += 1;
        }
      }
      const passed = hits === 0;
      return completedResult(config, passed ? 1 : 0, passed, {
        forbiddenConceptHitCount: hits,
      });
    }
    case "LLM_JUDGE":
    case "RAG_FAITHFULNESS":
    case "RAG_ANSWER_RELEVANCE":
    case "RAG_CONTEXT_PRECISION":
    case "RAG_CONTEXT_RECALL":
    case "SEMANTIC_SIMILARITY":
      return errorResult(config.type, "judge_execution_deferred");
    default: {
      const exhaustive: never = config;
      return errorResult(
        (exhaustive as EvaluatorConfig).type,
        "unsupported_evaluator",
      );
    }
  }
}

export function evaluateJsonExactMatchOutput(
  evaluator: Extract<EvaluatorConfig, { type: "JSON_EXACT_MATCH" }>,
  actual: JsonValue,
): { readonly passed: boolean; readonly score: number } {
  const passed = jsonValuesEqual(actual, evaluator.expected);
  return { passed, score: passed ? 1 : 0 };
}
