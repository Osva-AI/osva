import type { JsonValue, EvaluationCaseExpectedV1 } from "@osva-ai/contracts";
import {
  safeParseEvaluationCaseExpectedV1,
  type JudgeBackedEvaluatorType,
} from "@osva-ai/contracts";

import { outputTextFromJsonValue } from "../deterministic-evaluators/output.js";
import { formatQuestionFromCaseInput } from "./prompt-sections.js";

export interface RagEvaluationEvidence {
  readonly question: string;
  readonly generatedAnswer: string;
  readonly expected: EvaluationCaseExpectedV1;
}

export function parseSuiteExpected(
  caseExpected: JsonValue | undefined,
): EvaluationCaseExpectedV1 | null {
  if (caseExpected === undefined) {
    return null;
  }
  const parsed = safeParseEvaluationCaseExpectedV1(caseExpected);
  return parsed.success ? parsed.data : null;
}

/** Text form of the evaluated child Run output (not suite reference or RAG context). */
export function extractGeneratedAnswer(output: JsonValue): string | null {
  if (typeof output === "string") {
    return output.length > 0 ? output : null;
  }
  if (output === null) {
    return null;
  }
  if (typeof output === "number" && Number.isFinite(output)) {
    return String(output);
  }
  if (typeof output === "boolean") {
    return output ? "true" : "false";
  }
  const textAttempt = outputTextFromJsonValue(output);
  if (textAttempt.ok && textAttempt.text.length > 0) {
    return textAttempt.text;
  }
  const serialized = JSON.stringify(output);
  return serialized.length > 0 ? serialized : null;
}

export function validateRagEvidence(
  evaluatorType: JudgeBackedEvaluatorType,
  caseInput: JsonValue,
  caseExpected: JsonValue | undefined,
  targetOutput: JsonValue,
):
  | { readonly ok: true; readonly evidence: RagEvaluationEvidence }
  | { readonly ok: false; readonly errorCode: string } {
  const question = formatQuestionFromCaseInput(caseInput).trim();
  const generatedAnswer = extractGeneratedAnswer(targetOutput);
  if (generatedAnswer === null) {
    return { ok: false, errorCode: "rag_missing_generated_answer" };
  }

  const expected = parseSuiteExpected(caseExpected);

  switch (evaluatorType) {
    case "LLM_JUDGE":
      return {
        ok: true,
        evidence: {
          question,
          generatedAnswer,
          expected: expected ?? {
            schemaVersion: "a4.0",
          },
        },
      };
    case "RAG_FAITHFULNESS":
    case "RAG_CONTEXT_PRECISION":
    case "RAG_CONTEXT_RECALL": {
      if (expected?.context?.chunks === undefined) {
        return { ok: false, errorCode: "rag_missing_context" };
      }
      if (evaluatorType === "RAG_CONTEXT_PRECISION" && question.length === 0) {
        return { ok: false, errorCode: "rag_missing_question" };
      }
      if (evaluatorType === "RAG_CONTEXT_RECALL") {
        const hasFacts =
          expected.referenceFacts !== undefined &&
          expected.referenceFacts.length > 0;
        const hasReference =
          expected.referenceAnswer !== undefined &&
          expected.referenceAnswer.trim().length > 0;
        if (!hasFacts && !hasReference) {
          return { ok: false, errorCode: "rag_missing_reference" };
        }
      }
      return {
        ok: true,
        evidence: { question, generatedAnswer, expected },
      };
    }
    case "RAG_ANSWER_RELEVANCE": {
      if (question.length === 0) {
        return { ok: false, errorCode: "rag_missing_question" };
      }
      return {
        ok: true,
        evidence: {
          question,
          generatedAnswer,
          expected: expected ?? { schemaVersion: "a4.0" },
        },
      };
    }
    case "SEMANTIC_SIMILARITY": {
      if (expected?.referenceAnswer === undefined) {
        return { ok: false, errorCode: "rag_missing_reference" };
      }
      return {
        ok: true,
        evidence: { question, generatedAnswer, expected },
      };
    }
    default: {
      const exhaustive: never = evaluatorType;
      return { ok: false, errorCode: `unsupported_evaluator:${exhaustive}` };
    }
  }
}
