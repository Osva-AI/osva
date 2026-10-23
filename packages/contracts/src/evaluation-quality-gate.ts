export const EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION = 1 as const;

export const EVALUATION_QUALITY_GATE_ASSESSMENT_SCHEMA_VERSION = 1 as const;

export const EVALUATION_QUALITY_GATE_VERDICTS = [
  "PASS",
  "FAIL",
  "INDETERMINATE",
] as const;

export type EvaluationQualityGateVerdict =
  (typeof EVALUATION_QUALITY_GATE_VERDICTS)[number];

export const EVALUATION_QUALITY_GATE_METRICS = [
  "PASS_RATE",
  "QUALITY_SCORE",
  "COMPLETION_COVERAGE",
  "ERROR_COUNT",
  "ESTIMATED_COST_USD_MICROS",
  "DURATION_MS",
] as const;

export type EvaluationQualityGateMetric =
  (typeof EVALUATION_QUALITY_GATE_METRICS)[number];

export const EVALUATION_QUALITY_GATE_MIN_METRICS = [
  "PASS_RATE",
  "QUALITY_SCORE",
  "COMPLETION_COVERAGE",
] as const satisfies readonly EvaluationQualityGateMetric[];

export const EVALUATION_QUALITY_GATE_MAX_METRICS = [
  "ERROR_COUNT",
  "ESTIMATED_COST_USD_MICROS",
  "DURATION_MS",
] as const satisfies readonly EvaluationQualityGateMetric[];

export type EvaluationQualityGateMinMetric =
  (typeof EVALUATION_QUALITY_GATE_MIN_METRICS)[number];

export type EvaluationQualityGateMaxMetric =
  (typeof EVALUATION_QUALITY_GATE_MAX_METRICS)[number];

export const EVALUATION_QUALITY_GATE_RULE_OPERATORS = ["MIN", "MAX"] as const;

export type EvaluationQualityGateRuleOperator =
  (typeof EVALUATION_QUALITY_GATE_RULE_OPERATORS)[number];

export interface EvaluationQualityGateMinRuleV1 {
  readonly metric: EvaluationQualityGateMinMetric;
  readonly operator: "MIN";
  readonly threshold: number;
}

export interface EvaluationQualityGateMaxRuleV1 {
  readonly metric: EvaluationQualityGateMaxMetric;
  readonly operator: "MAX";
  readonly threshold: number;
}

export type EvaluationQualityGateRuleV1 =
  EvaluationQualityGateMinRuleV1 | EvaluationQualityGateMaxRuleV1;

export interface EvaluationQualityGatePolicyV1 {
  readonly schemaVersion: typeof EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION;
  readonly rules: readonly EvaluationQualityGateRuleV1[];
}

export const EVALUATION_QUALITY_GATE_REASON_CODES = {
  THRESHOLD_SATISFIED: "THRESHOLD_SATISFIED",
  THRESHOLD_VIOLATED: "THRESHOLD_VIOLATED",
  MISSING_EVIDENCE: "MISSING_EVIDENCE",
  COST_INCONCLUSIVE_UNPRICED: "COST_INCONCLUSIVE_UNPRICED",
  LIFECYCLE_INCOMPLETE: "LIFECYCLE_INCOMPLETE",
  LIFECYCLE_RUN_FAILED: "LIFECYCLE_RUN_FAILED",
  LIFECYCLE_RUN_CANCELLED: "LIFECYCLE_RUN_CANCELLED",
} as const;

export type EvaluationQualityGateReasonCode =
  (typeof EVALUATION_QUALITY_GATE_REASON_CODES)[keyof typeof EVALUATION_QUALITY_GATE_REASON_CODES];

export interface EvaluationQualityGateRuleResultV1 {
  readonly metric: EvaluationQualityGateMetric;
  readonly operator: EvaluationQualityGateRuleOperator;
  readonly threshold: number;
  readonly observedValue?: number;
  readonly verdict: EvaluationQualityGateVerdict;
  readonly reasonCode: EvaluationQualityGateReasonCode;
}

export interface EvaluationQualityGateAssessmentV1 {
  readonly schemaVersion: typeof EVALUATION_QUALITY_GATE_ASSESSMENT_SCHEMA_VERSION;
  readonly overallVerdict: EvaluationQualityGateVerdict;
  readonly lifecycleVerdict: EvaluationQualityGateVerdict;
  readonly ruleResults: readonly EvaluationQualityGateRuleResultV1[];
  readonly assessedAt: string;
}

export interface EvaluationRunQualityGateV1 {
  readonly policy: EvaluationQualityGatePolicyV1;
  readonly assessment?: EvaluationQualityGateAssessmentV1;
}
