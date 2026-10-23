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

  it("shows measured zeros when durationMs indicates aggregation ran", () => {
    const measuredZero = { ...placeholderSummary, durationMs: 1200 };
    expect(evaluationRunUsageSummaryIsMeasured(measuredZero)).toBe(true);
    expect(formatEvaluationRunInputTokens(measuredZero)).toBe("0");
    expect(formatEvaluationRunPricedCost(measuredZero)).toBe("$0.000000");
  });

  it("shows non-zero usage without durationMs", () => {
    const withTokens = { ...placeholderSummary, outputTokens: 42 };
    expect(evaluationRunUsageSummaryIsMeasured(withTokens)).toBe(true);
    expect(formatEvaluationRunInputTokens(withTokens)).toBe("0");
  });
});
