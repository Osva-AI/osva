import { formatUsdMicros } from "./formatting";

export const EVALUATION_RUN_USAGE_PENDING_LABEL = "Usage aggregation pending";

export interface EvaluationRunUsageSummaryFields {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly pricedCostUsdMicros: number;
  readonly unpricedModelCalls: number;
  readonly durationMs?: number;
}

/**
 * Domain evaluation-run usage totals are placeholders until batch usage
 * aggregation ships. When aggregation runs, it is expected to set durationMs
 * and/or non-zero usage fields; measured all-zero usage is shown as 0.
 */
export function evaluationRunUsageSummaryIsMeasured(
  summary: EvaluationRunUsageSummaryFields,
): boolean {
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
