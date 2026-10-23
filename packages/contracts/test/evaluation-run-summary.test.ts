import { describe, expect, it } from "vitest";

import { evaluationRunSummarySchema } from "../src/schemas/evaluation-suite.js";

describe("evaluationRunSummarySchema", () => {
  it("accepts scoring fields and optional quality score", () => {
    const parsed = evaluationRunSummarySchema.parse({
      totalCases: 2,
      pendingCases: 0,
      runningCases: 0,
      completedCases: 2,
      passedCases: 1,
      failedCases: 1,
      errorCases: 0,
      passRate: 0.5,
      completionCoverage: 1,
      validScoredCaseCount: 2,
      qualityScore: 0.5,
      inputTokens: 0,
      outputTokens: 0,
      pricedCostUsdMicros: 0,
      unpricedModelCalls: 0,
      usageMeasured: true,
    });

    expect(parsed.qualityScore).toBe(0.5);
  });

  it("allows omitting quality score when unscored", () => {
    const parsed = evaluationRunSummarySchema.parse({
      totalCases: 1,
      pendingCases: 0,
      runningCases: 0,
      completedCases: 1,
      passedCases: 0,
      failedCases: 0,
      errorCases: 1,
      passRate: 0,
      completionCoverage: 1,
      validScoredCaseCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      pricedCostUsdMicros: 0,
      unpricedModelCalls: 0,
      usageMeasured: false,
    });

    expect(parsed.qualityScore).toBeUndefined();
  });
});
