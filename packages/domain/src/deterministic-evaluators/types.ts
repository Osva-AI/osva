import type { EvaluatorType } from "@osva-ai/contracts";

export const DETERMINISTIC_EVALUATOR_RESULT_STATUSES = [
  "COMPLETED",
  "ERROR",
  "INVALID_CONFIG",
] as const;

export type DeterministicEvaluatorResultStatus =
  (typeof DETERMINISTIC_EVALUATOR_RESULT_STATUSES)[number];

export interface DeterministicEvaluatorCompletedResult {
  readonly type: EvaluatorType;
  readonly status: "COMPLETED";
  readonly score: number;
  readonly passed: boolean;
  readonly implementationVersion: string;
  readonly minPassingScore?: number;
  readonly matchedConceptCount?: number;
  readonly requiredConceptCount?: number;
  readonly forbiddenConceptHitCount?: number;
}

export interface DeterministicEvaluatorErrorResult {
  readonly type: EvaluatorType | string;
  readonly status: "ERROR" | "INVALID_CONFIG";
  readonly errorCode: string;
  readonly implementationVersion: string;
}

export type DeterministicEvaluatorResult =
  DeterministicEvaluatorCompletedResult | DeterministicEvaluatorErrorResult;

export interface DeterministicEvaluationCaseOutcome {
  readonly outcome: "PASS" | "FAIL" | "ERROR";
  readonly evaluatorResults: Readonly<Record<string, unknown>>;
}
