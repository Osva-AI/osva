import type {
  EvaluationCaseId,
  EvaluationRunId,
  ModelProfileVersionId,
} from "./ids.js";

export const EVALUATION_COMPARISON_POLICY_SCHEMA_VERSION = 1 as const;
export const EVALUATION_COMPARISON_PAIRWISE_CONFIG_SCHEMA_VERSION = 1 as const;
export const EVALUATION_COMPARISON_IMPLEMENTATION_VERSION = "a5.0" as const;
export const EVALUATION_COMPARISON_PAIRWISE_PROMPT_TEMPLATE_VERSION =
  "a5.0" as const;

export const EVALUATION_COMPARISON_STATES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
] as const;

export type EvaluationComparisonState =
  (typeof EVALUATION_COMPARISON_STATES)[number];

export function isEvaluationComparisonState(
  value: string,
): value is EvaluationComparisonState {
  return (EVALUATION_COMPARISON_STATES as readonly string[]).includes(value);
}

export const EVALUATION_COMPARISON_PROMOTION_RECOMMENDATIONS = [
  "PROMOTE",
  "BLOCK",
  "INDETERMINATE",
] as const;

export type EvaluationComparisonPromotionRecommendation =
  (typeof EVALUATION_COMPARISON_PROMOTION_RECOMMENDATIONS)[number];

export const EVALUATION_COMPARISON_PAIRWISE_PREFERENCES = [
  "BASELINE_BETTER",
  "CANDIDATE_BETTER",
  "TIE",
] as const;

export type EvaluationComparisonPairwisePreference =
  (typeof EVALUATION_COMPARISON_PAIRWISE_PREFERENCES)[number];

export const EVALUATION_COMPARISON_HUMAN_DECISIONS = [
  "BASELINE_BETTER",
  "CANDIDATE_BETTER",
  "TIE",
  "UNSURE",
] as const;

export type EvaluationComparisonHumanDecision =
  (typeof EVALUATION_COMPARISON_HUMAN_DECISIONS)[number];

export const EVALUATION_COMPARISON_PAIRWISE_JUDGMENT_POSITIONS = [
  "PRIMARY",
  "REVERSED",
] as const;

export type EvaluationComparisonPairwiseJudgmentPosition =
  (typeof EVALUATION_COMPARISON_PAIRWISE_JUDGMENT_POSITIONS)[number];

export const EVALUATION_COMPARISON_PAIRWISE_RUBRIC_MAX_LENGTH = 32_000;
export const EVALUATION_COMPARISON_PAIRWISE_INSTRUCTIONS_MAX_LENGTH = 4_000;
export const EVALUATION_COMPARISON_HUMAN_RATIONALE_MAX_LENGTH = 4_000;
export const EVALUATION_COMPARISON_CRITICAL_CASE_IDS_MAX = 64;

export interface EvaluationComparisonPolicyV1 {
  readonly schemaVersion: typeof EVALUATION_COMPARISON_POLICY_SCHEMA_VERSION;
  readonly minComparisonCoverage: number;
  readonly minValidScoredPairs: number;
  readonly maxMeanPairedScoreRegression: number;
  readonly maxPerCaseScoreRegression: number;
  readonly maxNewlyFailingCriticalCases: number;
  readonly maxNewEvaluatorErrors: number;
  readonly criticalCaseIds?: readonly EvaluationCaseId[];
  readonly minCandidatePairwiseWinRate?: number;
  readonly maxTotalKnownCostUsdMicros?: number;
  readonly requireCompleteTotalCost?: boolean;
}

export interface EvaluationComparisonPairwiseConfigV1 {
  readonly schemaVersion: typeof EVALUATION_COMPARISON_PAIRWISE_CONFIG_SCHEMA_VERSION;
  readonly enabled: boolean;
  readonly rubric: string;
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly maxOutputTokens?: number;
  readonly instructions?: string;
  readonly mitigatePositionBias?: boolean;
}

export interface EvaluationComparisonCasePairV1 {
  readonly evaluationCaseId: EvaluationCaseId;
  readonly caseKey: string;
  readonly baselineOutcome?: string;
  readonly candidateOutcome?: string;
  readonly baselineScore?: number;
  readonly candidateScore?: number;
  readonly scoreDelta?: number;
  readonly regressionDetected: boolean;
  readonly improvementDetected: boolean;
  readonly evidenceIncomplete: boolean;
  readonly baselineResultId?: string;
  readonly candidateResultId?: string;
}

export interface EvaluationComparisonDeterministicSummaryV1 {
  readonly schemaVersion: 1;
  readonly pairedCaseCount: number;
  readonly validScoredPairCount: number;
  readonly missingOrErrorPairCount: number;
  readonly baselineQualityScore?: number;
  readonly candidateQualityScore?: number;
  readonly meanPairedScoreDelta?: number;
  readonly improvedCaseCount: number;
  readonly regressedCaseCount: number;
  readonly unchangedCaseCount: number;
  readonly baselineOnlyMeanQualityScore?: number;
  readonly candidateOnlyMeanQualityScore?: number;
  readonly casePairs: readonly EvaluationComparisonCasePairV1[];
}

export interface EvaluationComparisonPairwiseCaseResultV1 {
  readonly evaluationCaseId: EvaluationCaseId;
  readonly primaryPreference?: EvaluationComparisonPairwisePreference;
  readonly reversedPreference?: EvaluationComparisonPairwisePreference;
  readonly canonicalPreference?: EvaluationComparisonPairwisePreference;
  readonly positionDisagreement: boolean;
  readonly incomplete: boolean;
  readonly errorCode?: string;
}

export interface EvaluationComparisonPairwiseSummaryV1 {
  readonly schemaVersion: 1;
  readonly enabled: boolean;
  readonly validJudgmentCount: number;
  readonly incompleteJudgmentCount: number;
  readonly baselineWins: number;
  readonly candidateWins: number;
  readonly ties: number;
  readonly positionDisagreementCount: number;
  readonly coverage: number;
  readonly candidateWinRate?: number;
  readonly baselineWinRate?: number;
  readonly tieRate?: number;
  readonly caseResults: readonly EvaluationComparisonPairwiseCaseResultV1[];
}

export const EVALUATION_COMPARISON_REASON_CODES = {
  RUNS_TERMINAL: "RUNS_TERMINAL",
  SUITE_VERSION_MATCH: "SUITE_VERSION_MATCH",
  COVERAGE_SATISFIED: "COVERAGE_SATISFIED",
  COVERAGE_INSUFFICIENT: "COVERAGE_INSUFFICIENT",
  SCORED_PAIRS_INSUFFICIENT: "SCORED_PAIRS_INSUFFICIENT",
  MEAN_REGRESSION_EXCEEDED: "MEAN_REGRESSION_EXCEEDED",
  CASE_REGRESSION_EXCEEDED: "CASE_REGRESSION_EXCEEDED",
  CRITICAL_CASE_REGRESSION: "CRITICAL_CASE_REGRESSION",
  NEW_EVALUATOR_ERRORS: "NEW_EVALUATOR_ERRORS",
  PAIRWISE_WIN_RATE_LOW: "PAIRWISE_WIN_RATE_LOW",
  PAIRWISE_INCOMPLETE: "PAIRWISE_INCOMPLETE",
  COST_UNKNOWN: "COST_UNKNOWN",
  COST_EXCEEDED: "COST_EXCEEDED",
  BASELINE_QUALITY_GATE_FAILED: "BASELINE_QUALITY_GATE_FAILED",
  CANDIDATE_QUALITY_GATE_FAILED: "CANDIDATE_QUALITY_GATE_FAILED",
  NO_BLOCKING_VIOLATION: "NO_BLOCKING_VIOLATION",
  EVIDENCE_INCOMPLETE: "EVIDENCE_INCOMPLETE",
} as const;

export type EvaluationComparisonReasonCode =
  (typeof EVALUATION_COMPARISON_REASON_CODES)[keyof typeof EVALUATION_COMPARISON_REASON_CODES];

export interface EvaluationComparisonRegressionAssessmentV1 {
  readonly schemaVersion: 1;
  readonly reasonCodes: readonly EvaluationComparisonReasonCode[];
  readonly blockingViolations: readonly EvaluationComparisonReasonCode[];
  readonly indeterminateReasons: readonly EvaluationComparisonReasonCode[];
  readonly assessedAt: string;
}

export interface EvaluationComparisonPromotionV1 {
  readonly recommendation: EvaluationComparisonPromotionRecommendation;
  readonly reasonCodes: readonly EvaluationComparisonReasonCode[];
  readonly assessedAt: string;
}

export interface EvaluationComparisonCostSummaryV1 {
  readonly baselinePricedCostUsdMicros: number;
  readonly candidatePricedCostUsdMicros: number;
  readonly pairwisePricedCostUsdMicros: number;
  readonly totalKnownCostUsdMicros: number;
  readonly unpricedModelCalls: number;
  readonly usageMeasured: boolean;
}

export interface CreateEvaluationComparisonInputV1 {
  readonly baselineEvaluationRunId: EvaluationRunId;
  readonly candidateEvaluationRunId: EvaluationRunId;
  readonly policy: EvaluationComparisonPolicyV1;
  readonly pairwise?: EvaluationComparisonPairwiseConfigV1;
}
