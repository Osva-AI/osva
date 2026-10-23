import { describe, expect, it } from "vitest";

import {
  EVALUATION_RUN_USAGE_PENDING_LABEL,
  evaluationRunUsageSummaryIsMeasured,
  formatEvaluationRunInputTokens,
  formatEvaluationRunPricedCost,
} from "../src/client/lib/evaluation-run-usage-display";

const placeholderSummary = {
  inputTokens: 0,
  outputTokens: 0,
  pricedCostUsdMicros: 0,
  unpricedModelCalls: 0,
  usageMeasured: false,
};

describe("evaluation run usage display", () => {
  it("treats all-zero placeholder summaries as not measured", () => {
    expect(evaluationRunUsageSummaryIsMeasured(placeholderSummary)).toBe(false);
    expect(formatEvaluationRunInputTokens(placeholderSummary)).toBe(
      EVALUATION_RUN_USAGE_PENDING_LABEL,
    );
    expect(formatEvaluationRunPricedCost(placeholderSummary)).toBe(
      EVALUATION_RUN_USAGE_PENDING_LABEL,
    );
  });

  it("shows measured zeros when usageMeasured is true", () => {
    const measuredZero = { ...placeholderSummary, usageMeasured: true };
    expect(evaluationRunUsageSummaryIsMeasured(measuredZero)).toBe(true);
    expect(formatEvaluationRunInputTokens(measuredZero)).toBe("0");
    expect(formatEvaluationRunPricedCost(measuredZero)).toBe("$0.000000");
  });

  it("shows non-zero usage when usageMeasured is true", () => {
    const withTokens = {
      ...placeholderSummary,
      outputTokens: 42,
      usageMeasured: true,
    };
    expect(evaluationRunUsageSummaryIsMeasured(withTokens)).toBe(true);
    expect(formatEvaluationRunInputTokens(withTokens)).toBe("0");
  });
});
