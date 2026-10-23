import type { EvaluationCaseId, RunId } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { InconsistentEvaluationCaseResultsError } from "../src/errors.js";
import {
  aggregateEvaluationRunSummary,
  meanNormalizedQualityScore,
  reconcileCaseResultsForScoring,
  scoreForEvaluationCaseOutcome,
  type EvaluationCaseResultForScoring,
} from "../src/evaluation-run-scoring.js";

function caseResult(
  id: string,
  evaluationCaseId: string,
  outcome: EvaluationCaseResultForScoring["outcome"],
  runId = `run-${evaluationCaseId}`,
): EvaluationCaseResultForScoring {
  return {
    id,
    evaluationCaseId: evaluationCaseId as EvaluationCaseId,
    outcome,
    runId: runId as RunId,
  };
}

describe("scoreForEvaluationCaseOutcome", () => {
  it("maps JSON_EXACT_MATCH-style outcomes to scores", () => {
    expect(scoreForEvaluationCaseOutcome("PASS")).toBe(1);
    expect(scoreForEvaluationCaseOutcome("FAIL")).toBe(0);
    expect(scoreForEvaluationCaseOutcome("ERROR")).toBeNull();
  });
});

describe("meanNormalizedQualityScore", () => {
  it("returns undefined when there are no scores", () => {
    expect(meanNormalizedQualityScore([])).toBeUndefined();
  });

  it("ignores non-finite values", () => {
    expect(
      meanNormalizedQualityScore([1, Number.NaN, Number.POSITIVE_INFINITY, 0]),
    ).toBe(0.5);
  });

  it("returns undefined when every value is non-finite", () => {
    expect(
      meanNormalizedQualityScore([Number.NaN, Number.POSITIVE_INFINITY]),
    ).toBeUndefined();
  });
});

describe("reconcileCaseResultsForScoring", () => {
  it("keeps one result per case id when outcomes agree", () => {
    const reconciled = reconcileCaseResultsForScoring([
      caseResult("b", "case-2", "FAIL"),
      caseResult("a", "case-1", "PASS"),
      caseResult("c", "case-1", "PASS"),
    ]);

    expect(reconciled).toEqual([
      caseResult("a", "case-1", "PASS"),
      caseResult("b", "case-2", "FAIL"),
    ]);
  });

  it("rejects inconsistent duplicate case results", () => {
    expect(() =>
      reconcileCaseResultsForScoring([
        caseResult("1", "case-a", "PASS"),
        caseResult("2", "case-a", "FAIL"),
      ]),
    ).toThrow(InconsistentEvaluationCaseResultsError);
  });
});

describe("aggregateEvaluationRunSummary", () => {
  it("aggregates when all cases pass", () => {
    const summary = aggregateEvaluationRunSummary(2, [
      caseResult("1", "case-a", "PASS"),
      caseResult("2", "case-b", "PASS"),
    ]);

    expect(summary).toMatchObject({
      totalCases: 2,
      completedCases: 2,
      pendingCases: 0,
      passedCases: 2,
      failedCases: 0,
      errorCases: 0,
      passRate: 1,
      completionCoverage: 1,
      validScoredCaseCount: 2,
      qualityScore: 1,
      usageMeasured: false,
    });
  });

  it("merges provided usage measurements", () => {
    const summary = aggregateEvaluationRunSummary(
      1,
      [caseResult("1", "case-a", "PASS")],
      {
        inputTokens: 10,
        outputTokens: 20,
        pricedCostUsdMicros: 100,
        unpricedModelCalls: 0,
        usageMeasured: true,
        durationMs: 500,
      },
    );

    expect(summary).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
      pricedCostUsdMicros: 100,
      usageMeasured: true,
      durationMs: 500,
    });
  });

  it("aggregates mixed pass and fail outcomes", () => {
    const summary = aggregateEvaluationRunSummary(2, [
      caseResult("1", "case-a", "PASS"),
      caseResult("2", "case-b", "FAIL"),
    ]);

    expect(summary).toMatchObject({
      passedCases: 1,
      failedCases: 1,
      passRate: 0.5,
      validScoredCaseCount: 2,
      qualityScore: 0.5,
    });
  });

  it("aggregates mixed pass, fail, and error outcomes", () => {
    const summary = aggregateEvaluationRunSummary(3, [
      caseResult("1", "case-a", "PASS"),
      caseResult("2", "case-b", "FAIL"),
      caseResult("3", "case-c", "ERROR"),
    ]);

    expect(summary).toMatchObject({
      passedCases: 1,
      failedCases: 1,
      errorCases: 1,
      passRate: 1 / 3,
      validScoredCaseCount: 2,
      qualityScore: 0.5,
    });
  });

  it("handles all error outcomes without a quality score", () => {
    const summary = aggregateEvaluationRunSummary(2, [
      caseResult("1", "case-a", "ERROR"),
      caseResult("2", "case-b", "ERROR"),
    ]);

    expect(summary).toMatchObject({
      errorCases: 2,
      validScoredCaseCount: 0,
      passRate: 0,
    });
    expect(summary.qualityScore).toBeUndefined();
  });

  it("handles zero total cases", () => {
    const summary = aggregateEvaluationRunSummary(0, []);

    expect(summary).toMatchObject({
      totalCases: 0,
      completedCases: 0,
      pendingCases: 0,
      passRate: 0,
      completionCoverage: 0,
      validScoredCaseCount: 0,
      usageMeasured: false,
    });
  });

  it("handles no completed cases", () => {
    const summary = aggregateEvaluationRunSummary(3, []);

    expect(summary).toMatchObject({
      completedCases: 0,
      pendingCases: 3,
      passRate: 0,
      completionCoverage: 0,
      validScoredCaseCount: 0,
    });
  });

  it("handles partially completed evaluations", () => {
    const summary = aggregateEvaluationRunSummary(4, [
      caseResult("1", "case-a", "PASS"),
      caseResult("2", "case-b", "FAIL"),
    ]);

    expect(summary).toMatchObject({
      completedCases: 2,
      pendingCases: 2,
      completionCoverage: 0.5,
      validScoredCaseCount: 2,
      qualityScore: 0.5,
      passRate: 0.25,
    });
  });

  it("produces stable aggregates regardless of input order", () => {
    const results = [
      caseResult("3", "case-c", "ERROR"),
      caseResult("1", "case-a", "PASS"),
      caseResult("2", "case-b", "FAIL"),
    ];
    const forward = aggregateEvaluationRunSummary(3, results);
    const reverse = aggregateEvaluationRunSummary(3, [...results].reverse());

    expect(forward).toEqual(reverse);
  });

  it("preserves legacy pass rate semantics", () => {
    const summary = aggregateEvaluationRunSummary(3, [
      caseResult("1", "case-a", "PASS"),
      caseResult("2", "case-b", "FAIL"),
      caseResult("3", "case-c", "FAIL"),
    ]);

    expect(summary.passRate).toBe(1 / 3);
  });
});
