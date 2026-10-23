import { formatUsdMicros } from "./formatting";

export const EVALUATION_RUN_USAGE_PENDING_LABEL = "Usage aggregation pending";

export interface EvaluationRunUsageSummaryFields {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly pricedCostUsdMicros: number;
  readonly unpricedModelCalls: number;
  readonly durationMs?: number;
  readonly usageMeasured?: boolean;
}

export function evaluationRunUsageSummaryIsMeasured(
  summary: EvaluationRunUsageSummaryFields,
): boolean {
  if (summary.usageMeasured !== undefined) {
    return summary.usageMeasured;
  }
  if (summary.durationMs !== undefined) {
    return true;
  }
  return (
    summary.inputTokens > 0 ||
    summary.outputTokens > 0 ||
    summary.pricedCostUsdMicros > 0 ||
    summary.unpricedModelCalls > 0
  );
}

function usageFieldLabel(
  summary: EvaluationRunUsageSummaryFields,
  measuredFormatter: () => string,
): string {
  if (!evaluationRunUsageSummaryIsMeasured(summary)) {
    return EVALUATION_RUN_USAGE_PENDING_LABEL;
  }
  return measuredFormatter();
}

export function formatEvaluationRunInputTokens(
  summary: EvaluationRunUsageSummaryFields,
): string {
  return usageFieldLabel(summary, () => String(summary.inputTokens));
}

export function formatEvaluationRunOutputTokens(
  summary: EvaluationRunUsageSummaryFields,
): string {
  return usageFieldLabel(summary, () => String(summary.outputTokens));
}

export function formatEvaluationRunPricedCost(
  summary: EvaluationRunUsageSummaryFields,
): string {
  return usageFieldLabel(summary, () =>
    formatUsdMicros(summary.pricedCostUsdMicros),
  );
}

export function formatEvaluationRunUnpricedModelCalls(
  summary: EvaluationRunUsageSummaryFields,
): string {
  return usageFieldLabel(summary, () => String(summary.unpricedModelCalls));
}
