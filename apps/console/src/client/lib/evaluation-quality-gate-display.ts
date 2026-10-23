import type {
  EvaluationQualityGateMetric,
  EvaluationQualityGateReasonCode,
  EvaluationQualityGateVerdict,
} from "@osva-ai/contracts";
import { EVALUATION_QUALITY_GATE_REASON_CODES } from "@osva-ai/contracts";

import { formatUsdMicros } from "./formatting";
import { formatPassRate } from "./evaluation-run-status";
import {
  formatCanonicalThresholdForDisplay,
  qualityGateMetricDefinition,
} from "./evaluation-quality-gate-config";
import type { EvaluationRunQualityGateResource } from "../hooks/use-evaluations";

export function formatQualityScore(qualityScore: number | undefined): string {
  if (qualityScore === undefined) {
    return "—";
  }
  if (!Number.isFinite(qualityScore)) {
    return "—";
  }
  return formatPassRate(qualityScore);
}

export function formatCompletionCoverage(coverage: number): string {
  return formatPassRate(coverage);
}

export function formatSummaryDurationMs(
  durationMs: number | undefined,
  runStatus: string,
  startedAt: string | undefined,
  completedAt: string | undefined,
  liveDurationLabel: string,
): string {
  if (durationMs !== undefined) {
    return `${durationMs} ms`;
  }
  if (runStatus === "PENDING" || runStatus === "RUNNING") {
    return liveDurationLabel;
  }
  return "—";
}

export function qualityGateReasonLabel(
  reasonCode: EvaluationQualityGateReasonCode | string,
): string {
  switch (reasonCode) {
    case EVALUATION_QUALITY_GATE_REASON_CODES.THRESHOLD_SATISFIED:
      return "Threshold satisfied.";
    case EVALUATION_QUALITY_GATE_REASON_CODES.THRESHOLD_VIOLATED:
      return "Threshold violated.";
    case EVALUATION_QUALITY_GATE_REASON_CODES.MISSING_EVIDENCE:
      return "Required evidence is not available yet.";
    case EVALUATION_QUALITY_GATE_REASON_CODES.COST_INCONCLUSIVE_UNPRICED:
      return "Priced subtotal alone is not enough; some model usage is unpriced.";
    case EVALUATION_QUALITY_GATE_REASON_CODES.LIFECYCLE_INCOMPLETE:
      return "Evaluation run has not finished.";
    case EVALUATION_QUALITY_GATE_REASON_CODES.LIFECYCLE_RUN_FAILED:
      return "Evaluation run failed.";
    case EVALUATION_QUALITY_GATE_REASON_CODES.LIFECYCLE_RUN_CANCELLED:
      return "Evaluation run was cancelled.";
    default:
      return String(reasonCode);
  }
}

export function qualityGateVerdictLabel(
  verdict: EvaluationQualityGateVerdict | string,
): string {
  if (verdict === "PASS") {
    return "Pass";
  }
  if (verdict === "FAIL") {
    return "Fail";
  }
  if (verdict === "INDETERMINATE") {
    return "Indeterminate";
  }
  return String(verdict);
}

export function qualityGateVerdictCategory(
  verdict: string,
): "neutral" | "success" | "error" | "active" {
  if (verdict === "PASS") {
    return "success";
  }
  if (verdict === "FAIL") {
    return "error";
  }
  if (verdict === "INDETERMINATE") {
    return "active";
  }
  return "neutral";
}

export interface ParsedQualityGateRuleResult {
  readonly metric: EvaluationQualityGateMetric | string;
  readonly operator: string;
  readonly threshold: number;
  readonly observedValue?: number;
  readonly verdict: string;
  readonly reasonCode: string;
}

export function parseQualityGateRuleResults(
  qualityGate: EvaluationRunQualityGateResource | undefined,
): readonly ParsedQualityGateRuleResult[] {
  const results = qualityGate?.assessment?.ruleResults;
  if (results === undefined) {
    return [];
  }
  return results.map((entry) => ({
    metric: String(entry.metric ?? ""),
    operator: String(entry.operator ?? ""),
    threshold: Number(entry.threshold),
    observedValue:
      entry.observedValue === undefined
        ? undefined
        : Number(entry.observedValue),
    verdict: String(entry.verdict ?? ""),
    reasonCode: String(entry.reasonCode ?? ""),
  }));
}

export function formatObservedGateValue(
  metric: string,
  observedValue: number | undefined,
): string {
  if (observedValue === undefined || !Number.isFinite(observedValue)) {
    return "—";
  }
  if (
    metric === "PASS_RATE" ||
    metric === "QUALITY_SCORE" ||
    metric === "COMPLETION_COVERAGE"
  ) {
    return formatPassRate(observedValue);
  }
  if (metric === "ESTIMATED_COST_USD_MICROS") {
    return formatUsdMicros(observedValue);
  }
  return String(observedValue);
}

export function formatConfiguredGateThreshold(
  metric: string,
  threshold: number,
): string {
  if (
    metric === "PASS_RATE" ||
    metric === "QUALITY_SCORE" ||
    metric === "COMPLETION_COVERAGE" ||
    metric === "ERROR_COUNT" ||
    metric === "ESTIMATED_COST_USD_MICROS" ||
    metric === "DURATION_MS"
  ) {
    const definition = qualityGateMetricDefinition(
      metric as EvaluationQualityGateMetric,
    );
    const display = formatCanonicalThresholdForDisplay(
      metric as EvaluationQualityGateMetric,
      threshold,
    );
    switch (definition.displayUnit) {
      case "percent":
        return `${display}%`;
      case "usd":
        return `$${display} (estimated priced usage)`;
      case "milliseconds":
        return `${display} ms`;
      case "integer":
        return display;
    }
  }
  return String(threshold);
}

export function formatGateOperatorLabel(operator: string): string {
  return operator === "MIN" ? "Minimum" : "Maximum";
}

export const ESTIMATED_COST_DISCLAIMER =
  "Estimated priced cost from measured model usage. Not actual provider billing.";

export function shouldShowUnpricedCostWarning(
  unpricedModelCalls: number,
  usageMeasured: boolean,
): boolean {
  return usageMeasured && unpricedModelCalls > 0;
}
