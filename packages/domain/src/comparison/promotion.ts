import type {
  EvaluationComparisonCostSummaryV1,
  EvaluationComparisonDeterministicSummaryV1,
  EvaluationComparisonPairwiseSummaryV1,
  EvaluationComparisonPolicyV1,
  EvaluationComparisonPromotionRecommendation,
  EvaluationComparisonPromotionV1,
  EvaluationComparisonReasonCode,
  EvaluationComparisonRegressionAssessmentV1,
  EvaluationQualityGateVerdict,
} from "@osva-ai/contracts";
import { EVALUATION_COMPARISON_REASON_CODES } from "@osva-ai/contracts";

export interface PromotionAssessmentInput {
  readonly policy: EvaluationComparisonPolicyV1;
  readonly deterministic: EvaluationComparisonDeterministicSummaryV1;
  readonly pairwise?: EvaluationComparisonPairwiseSummaryV1;
  readonly cost?: EvaluationComparisonCostSummaryV1;
  readonly baselineQualityGateVerdict?: EvaluationQualityGateVerdict;
  readonly candidateQualityGateVerdict?: EvaluationQualityGateVerdict;
  readonly assessedAt: Date;
}

export function assessComparisonRegressionAndPromotion(
  input: PromotionAssessmentInput,
): {
  readonly regression: EvaluationComparisonRegressionAssessmentV1;
  readonly promotion: EvaluationComparisonPromotionV1;
} {
  const blocking: EvaluationComparisonReasonCode[] = [];
  const indeterminate: EvaluationComparisonReasonCode[] = [];
  const informational: EvaluationComparisonReasonCode[] = [];

  const coverage =
    input.deterministic.pairedCaseCount === 0
      ? 0
      : (input.deterministic.pairedCaseCount -
          input.deterministic.missingOrErrorPairCount) /
        input.deterministic.pairedCaseCount;

  if (coverage < input.policy.minComparisonCoverage) {
    indeterminate.push(
      EVALUATION_COMPARISON_REASON_CODES.COVERAGE_INSUFFICIENT,
    );
  } else {
    informational.push(EVALUATION_COMPARISON_REASON_CODES.COVERAGE_SATISFIED);
  }

  if (
    input.deterministic.validScoredPairCount < input.policy.minValidScoredPairs
  ) {
    indeterminate.push(
      EVALUATION_COMPARISON_REASON_CODES.SCORED_PAIRS_INSUFFICIENT,
    );
  }

  if (
    input.deterministic.meanPairedScoreDelta !== undefined &&
    -input.deterministic.meanPairedScoreDelta >
      input.policy.maxMeanPairedScoreRegression
  ) {
    blocking.push(EVALUATION_COMPARISON_REASON_CODES.MEAN_REGRESSION_EXCEEDED);
  }

  let perCaseRegressionViolations = 0;
  let newEvaluatorErrors = 0;
  const criticalIds = new Set(input.policy.criticalCaseIds ?? []);
  let criticalRegressions = 0;

  for (const pair of input.deterministic.casePairs) {
    if (
      pair.scoreDelta !== undefined &&
      -pair.scoreDelta > input.policy.maxPerCaseScoreRegression
    ) {
      perCaseRegressionViolations += 1;
    }
    if (criticalIds.has(pair.evaluationCaseId)) {
      if (
        pair.baselineOutcome !== "FAIL" &&
        pair.baselineOutcome !== "ERROR" &&
        (pair.candidateOutcome === "FAIL" || pair.candidateOutcome === "ERROR")
      ) {
        criticalRegressions += 1;
      }
    }
    if (pair.candidateOutcome === "ERROR" && pair.baselineOutcome !== "ERROR") {
      newEvaluatorErrors += 1;
    }
  }

  if (perCaseRegressionViolations > 0) {
    blocking.push(EVALUATION_COMPARISON_REASON_CODES.CASE_REGRESSION_EXCEEDED);
  }

  if (criticalRegressions > input.policy.maxNewlyFailingCriticalCases) {
    blocking.push(EVALUATION_COMPARISON_REASON_CODES.CRITICAL_CASE_REGRESSION);
  }

  if (newEvaluatorErrors > input.policy.maxNewEvaluatorErrors) {
    blocking.push(EVALUATION_COMPARISON_REASON_CODES.NEW_EVALUATOR_ERRORS);
  }

  if (input.baselineQualityGateVerdict === "FAIL") {
    blocking.push(
      EVALUATION_COMPARISON_REASON_CODES.BASELINE_QUALITY_GATE_FAILED,
    );
  }
  if (input.candidateQualityGateVerdict === "FAIL") {
    blocking.push(
      EVALUATION_COMPARISON_REASON_CODES.CANDIDATE_QUALITY_GATE_FAILED,
    );
  }

  if (input.pairwise?.enabled === true) {
    if (
      input.pairwise.incompleteJudgmentCount > 0 ||
      input.pairwise.validJudgmentCount < input.deterministic.pairedCaseCount
    ) {
      indeterminate.push(
        EVALUATION_COMPARISON_REASON_CODES.PAIRWISE_INCOMPLETE,
      );
    }
    const minWin = input.policy.minCandidatePairwiseWinRate;
    if (
      minWin !== undefined &&
      input.pairwise.candidateWinRate !== undefined &&
      input.pairwise.candidateWinRate < minWin
    ) {
      blocking.push(EVALUATION_COMPARISON_REASON_CODES.PAIRWISE_WIN_RATE_LOW);
    }
  }

  if (input.cost !== undefined) {
    if (
      input.policy.requireCompleteTotalCost === true &&
      !input.cost.usageMeasured
    ) {
      indeterminate.push(EVALUATION_COMPARISON_REASON_CODES.COST_UNKNOWN);
    }
    const maxCost = input.policy.maxTotalKnownCostUsdMicros;
    if (
      maxCost !== undefined &&
      input.cost.usageMeasured &&
      input.cost.totalKnownCostUsdMicros > maxCost
    ) {
      blocking.push(EVALUATION_COMPARISON_REASON_CODES.COST_EXCEEDED);
    }
  }

  let recommendation: EvaluationComparisonPromotionRecommendation;
  if (blocking.length > 0) {
    recommendation = "BLOCK";
  } else if (indeterminate.length > 0) {
    recommendation = "INDETERMINATE";
  } else {
    recommendation = "PROMOTE";
    informational.push(
      EVALUATION_COMPARISON_REASON_CODES.NO_BLOCKING_VIOLATION,
    );
  }

  const reasonCodes = [...blocking, ...indeterminate, ...informational];
  return {
    regression: {
      schemaVersion: 1,
      reasonCodes,
      blockingViolations: blocking,
      indeterminateReasons: indeterminate,
      assessedAt: input.assessedAt.toISOString(),
    },
    promotion: {
      recommendation,
      reasonCodes,
      assessedAt: input.assessedAt.toISOString(),
    },
  };
}
