import { describe, expect, it } from "vitest";

import { computeHumanJudgeCalibration } from "../src/comparison/calibration.js";
import { computeDeterministicComparisonSummary } from "../src/comparison/deterministic.js";
import { aggregatePairwiseOutcomes } from "../src/comparison/pairwise-aggregate.js";
import { parsePairwiseVerdictJson } from "../src/comparison/pairwise-verdict.js";
import { assessComparisonRegressionAndPromotion } from "../src/comparison/promotion.js";

describe("A5 comparison deterministic engine", () => {
  it("computes paired score deltas by case id", () => {
    const summary = computeDeterministicComparisonSummary({
      cases: [
        { id: "ec-1" as never, key: "a" },
        { id: "ec-2" as never, key: "b" },
      ],
      baselineResults: [
        {
          id: "r1",
          evaluationCaseId: "ec-1" as never,
          outcome: "PASS",
          runId: "run" as never,
          evaluatorResults: { score: 0.9 },
        },
        {
          id: "r2",
          evaluationCaseId: "ec-2" as never,
          outcome: "PASS",
          runId: "run" as never,
          evaluatorResults: { score: 0.4 },
        },
      ],
      candidateResults: [
        {
          id: "r3",
          evaluationCaseId: "ec-1" as never,
          outcome: "PASS",
          runId: "run" as never,
          evaluatorResults: { score: 0.95 },
        },
        {
          id: "r4",
          evaluationCaseId: "ec-2" as never,
          outcome: "FAIL",
          runId: "run" as never,
          evaluatorResults: { score: 0.2 },
        },
      ],
    });

    expect(summary.validScoredPairCount).toBe(2);
    expect(summary.meanPairedScoreDelta).toBeCloseTo(
      (0.95 - 0.9 + (0.2 - 0.4)) / 2,
    );
    expect(summary.regressedCaseCount).toBe(1);
    expect(summary.improvedCaseCount).toBe(1);
  });

  it("marks missing scores as incomplete without zero", () => {
    const summary = computeDeterministicComparisonSummary({
      cases: [{ id: "ec-1" as never, key: "a" }],
      baselineResults: [
        {
          id: "r1",
          evaluationCaseId: "ec-1" as never,
          outcome: "ERROR",
          runId: "run" as never,
        },
      ],
      candidateResults: [
        {
          id: "r2",
          evaluationCaseId: "ec-1" as never,
          outcome: "PASS",
          runId: "run" as never,
          evaluatorResults: { score: 0.8 },
        },
      ],
    });
    expect(summary.missingOrErrorPairCount).toBe(1);
    expect(summary.validScoredPairCount).toBe(0);
    expect(summary.casePairs[0]?.scoreDelta).toBeUndefined();
  });
});

describe("A5 promotion policy", () => {
  const policy = {
    schemaVersion: 1 as const,
    minComparisonCoverage: 1,
    minValidScoredPairs: 1,
    maxMeanPairedScoreRegression: 0.05,
    maxPerCaseScoreRegression: 0.2,
    maxNewlyFailingCriticalCases: 0,
    maxNewEvaluatorErrors: 0,
  };

  it("returns PROMOTE when evidence passes", () => {
    const deterministic = computeDeterministicComparisonSummary({
      cases: [{ id: "ec-1" as never, key: "a" }],
      baselineResults: [
        {
          id: "r1",
          evaluationCaseId: "ec-1" as never,
          outcome: "PASS",
          runId: "run" as never,
          evaluatorResults: { score: 0.5 },
        },
      ],
      candidateResults: [
        {
          id: "r2",
          evaluationCaseId: "ec-1" as never,
          outcome: "PASS",
          runId: "run" as never,
          evaluatorResults: { score: 0.8 },
        },
      ],
    });
    const { promotion } = assessComparisonRegressionAndPromotion({
      policy,
      deterministic,
      assessedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(promotion.recommendation).toBe("PROMOTE");
  });

  it("returns BLOCK on mean regression", () => {
    const deterministic = computeDeterministicComparisonSummary({
      cases: [{ id: "ec-1" as never, key: "a" }],
      baselineResults: [
        {
          id: "r1",
          evaluationCaseId: "ec-1" as never,
          outcome: "PASS",
          runId: "run" as never,
          evaluatorResults: { score: 0.9 },
        },
      ],
      candidateResults: [
        {
          id: "r2",
          evaluationCaseId: "ec-1" as never,
          outcome: "FAIL",
          runId: "run" as never,
          evaluatorResults: { score: 0.1 },
        },
      ],
    });
    const { promotion } = assessComparisonRegressionAndPromotion({
      policy,
      deterministic,
      assessedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(promotion.recommendation).toBe("BLOCK");
  });
});

describe("A5 pairwise verdict and aggregation", () => {
  it("parses strict preference and maps PRIMARY slots", () => {
    const parsed = parsePairwiseVerdictJson(
      JSON.stringify({
        preference: "B_BETTER",
        reason: "More complete",
        evidence: ["Mentions required detail."],
      }),
      "PRIMARY",
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.verdict.canonicalPreference).toBe("CANDIDATE_BETTER");
    }
  });

  it("maps REVERSED A_BETTER to candidate", () => {
    const parsed = parsePairwiseVerdictJson(
      JSON.stringify({
        preference: "A_BETTER",
        reason: "Better",
        evidence: ["x"],
      }),
      "REVERSED",
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.verdict.canonicalPreference).toBe("CANDIDATE_BETTER");
    }
  });

  it("detects reversed-order disagreement", () => {
    const summary = aggregatePairwiseOutcomes({
      enabled: true,
      requireReversedJudgments: true,
      caseIds: ["ec-1" as never],
      outcomes: [
        {
          evaluationCaseId: "ec-1" as never,
          position: "PRIMARY",
          preference: "CANDIDATE_BETTER",
        },
        {
          evaluationCaseId: "ec-1" as never,
          position: "REVERSED",
          preference: "BASELINE_BETTER",
        },
      ],
    });
    expect(summary.positionDisagreementCount).toBe(1);
    expect(summary.validJudgmentCount).toBe(0);
  });
});

describe("A5 calibration", () => {
  it("computes agreement and confusion matrix", () => {
    const report = computeHumanJudgeCalibration([
      {
        judgePreference: "CANDIDATE_BETTER",
        humanDecision: "CANDIDATE_BETTER",
      },
      { judgePreference: "BASELINE_BETTER", humanDecision: "TIE" },
      { judgePreference: "TIE", humanDecision: "UNSURE" },
    ]);
    expect(report.eligiblePairedLabelCount).toBe(2);
    expect(report.exactAgreementCount).toBe(1);
    expect(report.agreementRate).toBe(0.5);
    expect(report.humanUnsureCount).toBe(1);
  });
});
