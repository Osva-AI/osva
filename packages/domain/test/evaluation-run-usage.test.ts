import type { RunAttemptId, RunId } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { EvaluationRun } from "../src/evaluation-run.js";
import { RunAttempt } from "../src/run-attempt.js";
import {
  collectRunAttemptIdsForUsageAccounting,
  computeEvaluationRunDurationMs,
  isMeasurableModelRunStep,
  mergeRunAttemptUsageSummaries,
} from "../src/evaluation-run-usage.js";
import type { RunAttemptUsageSummary } from "../src/ports/run-repository.js";

function usage(
  partial: Partial<RunAttemptUsageSummary>,
): RunAttemptUsageSummary {
  return {
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    estimatedCostUsdMicros: null,
    pricedModelCalls: 0,
    unpricedModelCalls: 0,
    ...partial,
  };
}

describe("collectRunAttemptIdsForUsageAccounting", () => {
  it("includes every attempt id across logical retries", () => {
    const runId = "run-1" as RunId;
    const attempts = [
      RunAttempt.rehydrate({
        id: "attempt-1" as RunAttemptId,
        runId,
        sequence: 1,
        status: "FAILED",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      RunAttempt.rehydrate({
        id: "attempt-2" as RunAttemptId,
        runId,
        sequence: 2,
        status: "SUCCEEDED",
        createdAt: new Date("2026-01-01T00:00:01.000Z"),
      }),
    ];

    expect(collectRunAttemptIdsForUsageAccounting(attempts, [runId])).toEqual([
      "attempt-1",
      "attempt-2",
    ]);
  });
});

describe("isMeasurableModelRunStep", () => {
  it("counts succeeded model steps and failed steps with recorded usage", () => {
    expect(
      isMeasurableModelRunStep({
        kind: "MODEL",
        status: "SUCCEEDED",
      }),
    ).toBe(true);
    expect(
      isMeasurableModelRunStep({
        kind: "MODEL",
        status: "FAILED",
        inputTokens: 5,
      }),
    ).toBe(true);
    expect(
      isMeasurableModelRunStep({
        kind: "MODEL",
        status: "FAILED",
      }),
    ).toBe(false);
  });
});

describe("mergeRunAttemptUsageSummaries", () => {
  it("sums tokens and priced costs without treating unpriced calls as priced", () => {
    const merged = mergeRunAttemptUsageSummaries([
      usage({
        inputTokens: 10,
        outputTokens: 5,
        estimatedCostUsdMicros: 100,
        unpricedModelCalls: 0,
      }),
      usage({
        inputTokens: 3,
        outputTokens: 7,
        estimatedCostUsdMicros: null,
        unpricedModelCalls: 2,
      }),
    ]);

    expect(merged).toEqual({
      inputTokens: 13,
      outputTokens: 12,
      pricedCostUsdMicros: 100,
      unpricedModelCalls: 2,
    });
  });

  it("returns zeros for empty input", () => {
    expect(mergeRunAttemptUsageSummaries([])).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      pricedCostUsdMicros: 0,
      unpricedModelCalls: 0,
    });
  });
});

describe("computeEvaluationRunDurationMs", () => {
  it("uses lifecycle timestamps for terminal evaluation runs", () => {
    const evaluationRun = EvaluationRun.rehydrate({
      id: "er-1" as import("@osva-ai/contracts").EvaluationRunId,
      workspaceId: "ws-1" as import("@osva-ai/contracts").WorkspaceId,
      evaluationSuiteVersionId:
        "esv-1" as import("@osva-ai/contracts").EvaluationSuiteVersionId,
      targetType: "AGENT_VERSION",
      targetVersionId: "av-1",
      status: "COMPLETED",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      completedAt: new Date("2026-01-01T00:00:05.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:05.000Z"),
    });

    expect(computeEvaluationRunDurationMs(evaluationRun)).toBe(5000);
  });

  it("does not expose duration for nonterminal evaluation runs", () => {
    const evaluationRun = EvaluationRun.rehydrate({
      id: "er-1" as import("@osva-ai/contracts").EvaluationRunId,
      workspaceId: "ws-1" as import("@osva-ai/contracts").WorkspaceId,
      evaluationSuiteVersionId:
        "esv-1" as import("@osva-ai/contracts").EvaluationSuiteVersionId,
      targetType: "AGENT_VERSION",
      targetVersionId: "av-1",
      status: "RUNNING",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(computeEvaluationRunDurationMs(evaluationRun)).toBeUndefined();
  });
});
