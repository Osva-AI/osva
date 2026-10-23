import type {
  EvaluationQualityGateAssessmentV1,
  EvaluationQualityGatePolicyV1,
  EvaluationQualityGateReasonCode,
  EvaluationQualityGateRuleResultV1,
  EvaluationQualityGateRuleV1,
  EvaluationQualityGateVerdict,
  EvaluationRunState,
} from "@osva-ai/contracts";
import {
  EVALUATION_QUALITY_GATE_ASSESSMENT_SCHEMA_VERSION,
  EVALUATION_QUALITY_GATE_REASON_CODES,
} from "@osva-ai/contracts";

import type { EvaluationRunSummary } from "./evaluation-run-scoring.js";
import { TERMINAL_EVALUATION_RUN_STATES } from "./evaluation-run-state-machine.js";

type EstimatedCostMaxRule = {
  readonly metric: "ESTIMATED_COST_USD_MICROS";
  readonly operator: "MAX";
  readonly threshold: number;
};

export interface AssessEvaluationQualityGateInput {
  readonly policy: EvaluationQualityGatePolicyV1;
  readonly evaluationRunStatus: EvaluationRunState;
  readonly summary: EvaluationRunSummary;
  readonly assessedAt: Date;
  readonly allowFinalPass: boolean;
}

export function assessEvaluationQualityGate(
  input: AssessEvaluationQualityGateInput,
): EvaluationQualityGateAssessmentV1 {
  const lifecycleVerdict = evaluateLifecycleVerdict(
    input.evaluationRunStatus,
    input.allowFinalPass,
  );

  const sortedRules = [...input.policy.rules].sort((left, right) =>
    left.metric.localeCompare(right.metric),
  );

  const ruleResults = sortedRules.map((rule) =>
    evaluateQualityGateRule(rule, input.summary),
  );

  const thresholdVerdict = combineThresholdVerdicts(ruleResults);
  const overallVerdict = combineOverallVerdict(
    lifecycleVerdict,
    thresholdVerdict,
  );

  return {
    schemaVersion: EVALUATION_QUALITY_GATE_ASSESSMENT_SCHEMA_VERSION,
    overallVerdict,
    lifecycleVerdict,
    ruleResults,
    assessedAt: input.assessedAt.toISOString(),
  };
}

function evaluateLifecycleVerdict(
  status: EvaluationRunState,
  allowFinalPass: boolean,
): EvaluationQualityGateVerdict {
  if (status === "CANCELLED") {
    return "FAIL";
  }
  if (status === "FAILED") {
    return "FAIL";
  }
  if (!allowFinalPass) {
    return "INDETERMINATE";
  }
  if (!(TERMINAL_EVALUATION_RUN_STATES as readonly string[]).includes(status)) {
    return "INDETERMINATE";
  }
  if (status !== "COMPLETED") {
    return "FAIL";
  }
  return "PASS";
}

function evaluateQualityGateRule(
  rule: EvaluationQualityGateRuleV1,
  summary: EvaluationRunSummary,
): EvaluationQualityGateRuleResultV1 {
  if (rule.operator === "MIN") {
    return evaluateMinRule(rule, summary);
  }
  return evaluateMaxRule(rule, summary);
}

function evaluateMinRule(
  rule: Extract<EvaluationQualityGateRuleV1, { readonly operator: "MIN" }>,
  summary: EvaluationRunSummary,
): EvaluationQualityGateRuleResultV1 {
  const observed = readMinMetricValue(rule.metric, summary);
  if (observed === undefined) {
    return {
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      verdict: "INDETERMINATE",
      reasonCode: EVALUATION_QUALITY_GATE_REASON_CODES.MISSING_EVIDENCE,
    };
  }

  const passed = observed >= rule.threshold;
  return {
    metric: rule.metric,
    operator: rule.operator,
    threshold: rule.threshold,
    observedValue: observed,
    verdict: passed ? "PASS" : "FAIL",
    reasonCode: passed
      ? EVALUATION_QUALITY_GATE_REASON_CODES.THRESHOLD_SATISFIED
      : EVALUATION_QUALITY_GATE_REASON_CODES.THRESHOLD_VIOLATED,
  };
}

function evaluateMaxRule(
  rule: Extract<EvaluationQualityGateRuleV1, { readonly operator: "MAX" }>,
  summary: EvaluationRunSummary,
): EvaluationQualityGateRuleResultV1 {
  if (rule.metric === "ESTIMATED_COST_USD_MICROS") {
    return evaluateEstimatedCostMaxRule(rule as EstimatedCostMaxRule, summary);
  }

  const observed = readMaxMetricValue(rule.metric, summary);
  if (observed === undefined) {
    return {
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      verdict: "INDETERMINATE",
      reasonCode: EVALUATION_QUALITY_GATE_REASON_CODES.MISSING_EVIDENCE,
    };
  }

  const passed = observed <= rule.threshold;
  return {
    metric: rule.metric,
    operator: rule.operator,
    threshold: rule.threshold,
    observedValue: observed,
    verdict: passed ? "PASS" : "FAIL",
    reasonCode: passed
      ? EVALUATION_QUALITY_GATE_REASON_CODES.THRESHOLD_SATISFIED
      : EVALUATION_QUALITY_GATE_REASON_CODES.THRESHOLD_VIOLATED,
  };
}

function evaluateEstimatedCostMaxRule(
  rule: EstimatedCostMaxRule,
  summary: EvaluationRunSummary,
): EvaluationQualityGateRuleResultV1 {
  const observed = summary.pricedCostUsdMicros;

  if (observed > rule.threshold) {
    return {
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      observedValue: observed,
      verdict: "FAIL",
      reasonCode: EVALUATION_QUALITY_GATE_REASON_CODES.THRESHOLD_VIOLATED,
    };
  }

  if (!summary.usageMeasured || summary.unpricedModelCalls > 0) {
    return {
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      observedValue: observed,
      verdict: "INDETERMINATE",
      reasonCode:
        EVALUATION_QUALITY_GATE_REASON_CODES.COST_INCONCLUSIVE_UNPRICED,
    };
  }

  return {
    metric: rule.metric,
    operator: rule.operator,
    threshold: rule.threshold,
    observedValue: observed,
    verdict: "PASS",
    reasonCode: EVALUATION_QUALITY_GATE_REASON_CODES.THRESHOLD_SATISFIED,
  };
}

function readMinMetricValue(
  metric: Extract<
    EvaluationQualityGateRuleV1,
    { readonly operator: "MIN" }
  >["metric"],
  summary: EvaluationRunSummary,
): number | undefined {
  switch (metric) {
    case "PASS_RATE":
      return summary.passRate;
    case "QUALITY_SCORE":
      return summary.qualityScore;
    case "COMPLETION_COVERAGE":
      return summary.completionCoverage;
  }
}

function readMaxMetricValue(
  metric: Extract<
    EvaluationQualityGateRuleV1,
    { readonly operator: "MAX" }
  >["metric"],
  summary: EvaluationRunSummary,
): number | undefined {
  switch (metric) {
    case "ERROR_COUNT":
      return summary.errorCases;
    case "ESTIMATED_COST_USD_MICROS":
      return summary.pricedCostUsdMicros;
    case "DURATION_MS":
      return summary.durationMs;
  }
}

function combineThresholdVerdicts(
  ruleResults: readonly EvaluationQualityGateRuleResultV1[],
): EvaluationQualityGateVerdict {
  if (ruleResults.some((result) => result.verdict === "FAIL")) {
    return "FAIL";
  }
  if (ruleResults.some((result) => result.verdict === "INDETERMINATE")) {
    return "INDETERMINATE";
  }
  return "PASS";
}

function combineOverallVerdict(
  lifecycleVerdict: EvaluationQualityGateVerdict,
  thresholdVerdict: EvaluationQualityGateVerdict,
): EvaluationQualityGateVerdict {
  if (lifecycleVerdict === "FAIL" || thresholdVerdict === "FAIL") {
    return "FAIL";
  }
  if (
    lifecycleVerdict === "INDETERMINATE" ||
    thresholdVerdict === "INDETERMINATE"
  ) {
    return "INDETERMINATE";
  }
  return "PASS";
}

export function lifecycleReasonCodeForStatus(
  status: EvaluationRunState,
): EvaluationQualityGateReasonCode | undefined {
  if (status === "CANCELLED") {
    return EVALUATION_QUALITY_GATE_REASON_CODES.LIFECYCLE_RUN_CANCELLED;
  }
  if (status === "FAILED") {
    return EVALUATION_QUALITY_GATE_REASON_CODES.LIFECYCLE_RUN_FAILED;
  }
  if (status === "PENDING" || status === "RUNNING") {
    return EVALUATION_QUALITY_GATE_REASON_CODES.LIFECYCLE_INCOMPLETE;
  }
  return undefined;
}
