import type {
  EvaluationCaseId,
  EvaluationCaseOutcome,
  RunId,
} from "@osva-ai/contracts";

import { InconsistentEvaluationCaseResultsError } from "./errors.js";
import type { EvaluationRunUsageMeasurement } from "./evaluation-run-usage.js";
import { UNMEASURED_EVALUATION_RUN_USAGE } from "./evaluation-run-usage.js";

export interface EvaluationCaseResultForScoring {
  readonly id: string;
  readonly evaluationCaseId: EvaluationCaseId;
  readonly outcome: EvaluationCaseOutcome;
  readonly runId: RunId;
  readonly completedAt?: Date;
}

export interface EvaluationRunSummary {
  readonly totalCases: number;
  readonly pendingCases: number;
  readonly runningCases: number;
  readonly completedCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly errorCases: number;
  readonly passRate: number;
  readonly completionCoverage: number;
  readonly validScoredCaseCount: number;
  readonly qualityScore?: number;
  readonly durationMs?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly pricedCostUsdMicros: number;
  readonly unpricedModelCalls: number;
  readonly usageMeasured: boolean;
}

/**
 * Deterministic per-case score for JSON_EXACT_MATCH-style batch outcomes.
 * ERROR and unreconciled cases do not contribute a score.
 */
export function scoreForEvaluationCaseOutcome(
  outcome: EvaluationCaseOutcome,
): number | null {
  if (outcome === "PASS") {
    return 1;
  }
  if (outcome === "FAIL") {
    return 0;
  }
  return null;
}

/**
 * Mean of finite scores in [0, 1]. Returns undefined when no valid scores exist.
 */
export function meanNormalizedQualityScore(
  scores: readonly number[],
): number | undefined {
  let sum = 0;
  let count = 0;
  for (const score of scores) {
    if (!Number.isFinite(score)) {
      continue;
    }
    sum += score;
    count += 1;
  }
  if (count === 0) {
    return undefined;
  }
  return sum / count;
}

export function reconcileCaseResultsForScoring<
  T extends EvaluationCaseResultForScoring,
>(caseResults: readonly T[]): readonly T[] {
  const byCaseId = new Map<string, T>();

  for (const result of caseResults) {
    const existing = byCaseId.get(result.evaluationCaseId);
    if (existing === undefined) {
      byCaseId.set(result.evaluationCaseId, result);
      continue;
    }

    if (existing.outcome !== result.outcome) {
      throw new InconsistentEvaluationCaseResultsError(result.evaluationCaseId);
    }

    if (result.id.localeCompare(existing.id) < 0) {
      byCaseId.set(result.evaluationCaseId, result);
    }
  }

  return [...byCaseId.values()].sort((left, right) =>
    left.evaluationCaseId.localeCompare(right.evaluationCaseId),
  );
}

/** @deprecated Use reconcileCaseResultsForScoring */
export function dedupeEvaluationCaseResultsForScoring<
  T extends EvaluationCaseResultForScoring,
>(caseResults: readonly T[]): readonly T[] {
  return reconcileCaseResultsForScoring(caseResults);
}

export function aggregateEvaluationRunSummary(
  totalCases: number,
  caseResults: readonly EvaluationCaseResultForScoring[],
  usage: EvaluationRunUsageMeasurement = UNMEASURED_EVALUATION_RUN_USAGE,
): EvaluationRunSummary {
  if (!Number.isInteger(totalCases) || totalCases < 0) {
    throw new Error("totalCases must be a non-negative integer.");
  }

  const reconciled = reconcileCaseResultsForScoring(caseResults);
  const passedCases = reconciled.filter(
    (result) => result.outcome === "PASS",
  ).length;
  const failedCases = reconciled.filter(
    (result) => result.outcome === "FAIL",
  ).length;
  const errorCases = reconciled.filter(
    (result) => result.outcome === "ERROR",
  ).length;
  const completedCases = reconciled.length;
  const pendingCases = Math.max(totalCases - completedCases, 0);

  const passRate = totalCases === 0 ? 0 : passedCases / totalCases;
  const completionCoverage =
    totalCases === 0 ? 0 : Math.min(completedCases, totalCases) / totalCases;

  const caseScores: number[] = [];
  for (const result of reconciled) {
    const score = scoreForEvaluationCaseOutcome(result.outcome);
    if (score !== null) {
      caseScores.push(score);
    }
  }
  const validScoredCaseCount = caseScores.length;
  const qualityScore = meanNormalizedQualityScore(caseScores);

  return {
    totalCases,
    pendingCases,
    runningCases: 0,
    completedCases,
    passedCases,
    failedCases,
    errorCases,
    passRate,
    completionCoverage,
    validScoredCaseCount,
    ...(qualityScore === undefined ? {} : { qualityScore }),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    pricedCostUsdMicros: usage.pricedCostUsdMicros,
    unpricedModelCalls: usage.unpricedModelCalls,
    usageMeasured: usage.usageMeasured,
    ...(usage.durationMs === undefined ? {} : { durationMs: usage.durationMs }),
  };
}
