import { describe, expect, it, vi } from "vitest";

import { EvaluationComparisonsResource } from "../src/resources/evaluation-comparisons.js";

describe("EvaluationComparisonsResource", () => {
  const request = vi.fn().mockResolvedValue({ comparisons: [] });

  const resource = new EvaluationComparisonsResource({ request } as never);

  it("covers comparison CRUD-style read paths", async () => {
    await resource.create({
      baselineEvaluationRunId: "er-base" as never,
      candidateEvaluationRunId: "er-cand" as never,
      policy: {
        schemaVersion: 1,
        minComparisonCoverage: 0,
        minValidScoredPairs: 1,
        maxMeanPairedScoreRegression: 1,
        maxPerCaseScoreRegression: 1,
        maxNewlyFailingCriticalCases: 0,
        maxNewEvaluatorErrors: 0,
      },
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/evaluation-comparisons",
      body: expect.any(Object),
    });

    await resource.list({ limit: 10, status: "RUNNING" });
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/v1/evaluation-comparisons",
      query: expect.objectContaining({
        limit: "10",
        status: "RUNNING",
      }),
    });

    await resource.get("cmp/a+b" as never);
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/v1/evaluation-comparisons/cmp%2Fa%2Bb",
    });

    await resource.listPairwiseResults("cmp-1" as never);
    await resource.getAssessment("cmp-1" as never);
    await resource.listHumanReviews("cmp-1" as never);
    await resource.getCalibration("cmp-1" as never);

    expect(
      Object.getOwnPropertyNames(EvaluationComparisonsResource.prototype),
    ).not.toContain("submitHumanReview");
  });

  it("propagates HTTP errors", async () => {
    request.mockRejectedValueOnce(new Error("transport"));
    await expect(resource.get("cmp-1" as never)).rejects.toThrow("transport");
  });
});
