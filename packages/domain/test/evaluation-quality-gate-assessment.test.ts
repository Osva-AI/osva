import {
  EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
  type EvaluationQualityGatePolicyV1,
  type EvaluationQualityGateRuleV1,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { assessEvaluationQualityGate } from "../src/evaluation-quality-gate-assessment.js";
import type { EvaluationRunSummary } from "../src/evaluation-run-scoring.js";

const ASSESSED_AT = new Date("2026-01-01T00:00:00.000Z");

function baseSummary(
  overrides: Partial<EvaluationRunSummary> = {},
): EvaluationRunSummary {
  return {
    totalCases: 2,
    pendingCases: 0,
    runningCases: 0,
    completedCases: 2,
    passedCases: 2,
    failedCases: 0,
    errorCases: 0,
    passRate: 1,
    completionCoverage: 1,
    validScoredCaseCount: 2,
    qualityScore: 1,
    durationMs: 100,
    inputTokens: 0,
    outputTokens: 0,
    pricedCostUsdMicros: 0,
    unpricedModelCalls: 0,
    usageMeasured: true,
    ...overrides,
  };
}

function policy(
  rules: readonly EvaluationQualityGateRuleV1[],
): EvaluationQualityGatePolicyV1 {
  return {
    schemaVersion: EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
    rules,
  };
}

describe("assessEvaluationQualityGate", () => {
  it("passes when all thresholds are satisfied on a completed run", () => {
    const result = assessEvaluationQualityGate({
      policy: policy([
        { metric: "PASS_RATE", operator: "MIN", threshold: 1 },
        { metric: "QUALITY_SCORE", operator: "MIN", threshold: 0.9 },
      ]),
      evaluationRunStatus: "COMPLETED",
      summary: baseSummary(),
      assessedAt: ASSESSED_AT,
      allowFinalPass: true,
    });

    expect(result.overallVerdict).toBe("PASS");
    expect(result.lifecycleVerdict).toBe("PASS");
    expect(result.ruleResults.every((rule) => rule.verdict === "PASS")).toBe(
      true,
    );
  });

  it("fails on a single threshold violation", () => {
    const result = assessEvaluationQualityGate({
      policy: policy([{ metric: "PASS_RATE", operator: "MIN", threshold: 1 }]),
      evaluationRunStatus: "COMPLETED",
      summary: baseSummary({ passRate: 0.5, passedCases: 1, failedCases: 1 }),
      assessedAt: ASSESSED_AT,
      allowFinalPass: true,
    });

    expect(result.overallVerdict).toBe("FAIL");
    expect(result.ruleResults[0]?.reasonCode).toBe("THRESHOLD_VIOLATED");
  });

  it("reports multiple simultaneous failures", () => {
    const result = assessEvaluationQualityGate({
      policy: policy([
        { metric: "PASS_RATE", operator: "MIN", threshold: 1 },
        { metric: "ERROR_COUNT", operator: "MAX", threshold: 0 },
      ]),
      evaluationRunStatus: "COMPLETED",
      summary: baseSummary({
        passRate: 0,
        passedCases: 0,
        failedCases: 1,
        errorCases: 2,
      }),
      assessedAt: ASSESSED_AT,
      allowFinalPass: true,
    });

    expect(result.overallVerdict).toBe("FAIL");
    expect(
      result.ruleResults.filter((rule) => rule.verdict === "FAIL"),
    ).toHaveLength(2);
  });

  it("is indeterminate when quality score is missing", () => {
    const result = assessEvaluationQualityGate({
      policy: policy([
        { metric: "QUALITY_SCORE", operator: "MIN", threshold: 0.5 },
      ]),
      evaluationRunStatus: "COMPLETED",
      summary: baseSummary({ qualityScore: undefined }),
      assessedAt: ASSESSED_AT,
      allowFinalPass: true,
    });

    expect(result.ruleResults[0]?.verdict).toBe("INDETERMINATE");
    expect(result.ruleResults[0]?.reasonCode).toBe("MISSING_EVIDENCE");
    expect(result.overallVerdict).toBe("INDETERMINATE");
  });

  it("is indeterminate when duration is missing", () => {
    const result = assessEvaluationQualityGate({
      policy: policy([
        { metric: "DURATION_MS", operator: "MAX", threshold: 1000 },
      ]),
      evaluationRunStatus: "COMPLETED",
      summary: baseSummary({ durationMs: undefined }),
      assessedAt: ASSESSED_AT,
      allowFinalPass: true,
    });

    expect(result.ruleResults[0]?.verdict).toBe("INDETERMINATE");
    expect(result.overallVerdict).toBe("INDETERMINATE");
  });

  it("is indeterminate for cost when priced subtotal is within threshold but pricing is incomplete", () => {
    const result = assessEvaluationQualityGate({
      policy: policy([
        {
          metric: "ESTIMATED_COST_USD_MICROS",
          operator: "MAX",
          threshold: 100,
        },
      ]),
      evaluationRunStatus: "COMPLETED",
      summary: baseSummary({
        pricedCostUsdMicros: 50,
        unpricedModelCalls: 1,
        usageMeasured: true,
      }),
      assessedAt: ASSESSED_AT,
      allowFinalPass: true,
    });

    expect(result.ruleResults[0]?.reasonCode).toBe(
      "COST_INCONCLUSIVE_UNPRICED",
    );
    expect(result.ruleResults[0]?.verdict).toBe("INDETERMINATE");
    expect(result.overallVerdict).toBe("INDETERMINATE");
  });

  it("fails cost when priced subtotal exceeds threshold even with unpriced calls", () => {
    const result = assessEvaluationQualityGate({
      policy: policy([
        {
          metric: "ESTIMATED_COST_USD_MICROS",
          operator: "MAX",
          threshold: 100,
        },
      ]),
      evaluationRunStatus: "COMPLETED",
      summary: baseSummary({
        pricedCostUsdMicros: 150,
        unpricedModelCalls: 2,
        usageMeasured: true,
      }),
      assessedAt: ASSESSED_AT,
      allowFinalPass: true,
    });

    expect(result.ruleResults[0]?.verdict).toBe("FAIL");
    expect(result.ruleResults[0]?.reasonCode).toBe("THRESHOLD_VIOLATED");
    expect(result.overallVerdict).toBe("FAIL");
  });

  it("passes cost only when pricing is complete and subtotal is within threshold", () => {
    const result = assessEvaluationQualityGate({
      policy: policy([
        {
          metric: "ESTIMATED_COST_USD_MICROS",
          operator: "MAX",
          threshold: 100,
        },
      ]),
      evaluationRunStatus: "COMPLETED",
      summary: baseSummary({
        pricedCostUsdMicros: 100,
        unpricedModelCalls: 0,
        usageMeasured: true,
      }),
      assessedAt: ASSESSED_AT,
      allowFinalPass: true,
    });

    expect(result.ruleResults[0]?.verdict).toBe("PASS");
    expect(result.overallVerdict).toBe("PASS");
  });

  it("never final-passes an incomplete run", () => {
    const result = assessEvaluationQualityGate({
      policy: policy([{ metric: "PASS_RATE", operator: "MIN", threshold: 0 }]),
      evaluationRunStatus: "RUNNING",
      summary: baseSummary({ completionCoverage: 0.5, runningCases: 1 }),
      assessedAt: ASSESSED_AT,
      allowFinalPass: false,
    });

    expect(result.lifecycleVerdict).toBe("INDETERMINATE");
    expect(result.overallVerdict).not.toBe("PASS");
  });

  it("fails failed and cancelled runs regardless of metrics", () => {
    const failed = assessEvaluationQualityGate({
      policy: policy([{ metric: "PASS_RATE", operator: "MIN", threshold: 0 }]),
      evaluationRunStatus: "FAILED",
      summary: baseSummary(),
      assessedAt: ASSESSED_AT,
      allowFinalPass: true,
    });
    expect(failed.overallVerdict).toBe("FAIL");

    const cancelled = assessEvaluationQualityGate({
      policy: policy([{ metric: "PASS_RATE", operator: "MIN", threshold: 0 }]),
      evaluationRunStatus: "CANCELLED",
      summary: baseSummary(),
      assessedAt: ASSESSED_AT,
      allowFinalPass: true,
    });
    expect(cancelled.overallVerdict).toBe("FAIL");
  });

  it("treats boundary equality as satisfied", () => {
    const result = assessEvaluationQualityGate({
      policy: policy([
        { metric: "PASS_RATE", operator: "MIN", threshold: 0.5 },
        { metric: "ERROR_COUNT", operator: "MAX", threshold: 1 },
      ]),
      evaluationRunStatus: "COMPLETED",
      summary: baseSummary({
        passRate: 0.5,
        passedCases: 1,
        failedCases: 1,
        errorCases: 1,
      }),
      assessedAt: ASSESSED_AT,
      allowFinalPass: true,
    });

    expect(result.overallVerdict).toBe("PASS");
  });

  it("produces deterministic rule ordering independent of input order", () => {
    const rules = [
      {
        metric: "QUALITY_SCORE" as const,
        operator: "MIN" as const,
        threshold: 0,
      },
      { metric: "PASS_RATE" as const, operator: "MIN" as const, threshold: 0 },
    ];
    const first = assessEvaluationQualityGate({
      policy: policy(rules),
      evaluationRunStatus: "COMPLETED",
      summary: baseSummary(),
      assessedAt: ASSESSED_AT,
      allowFinalPass: true,
    });
    const second = assessEvaluationQualityGate({
      policy: policy([rules[1]!, rules[0]!]),
      evaluationRunStatus: "COMPLETED",
      summary: baseSummary(),
      assessedAt: ASSESSED_AT,
      allowFinalPass: true,
    });

    expect(first.ruleResults.map((rule) => rule.metric)).toEqual(
      second.ruleResults.map((rule) => rule.metric),
    );
  });
});
