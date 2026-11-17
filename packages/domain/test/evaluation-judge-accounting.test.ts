import { describe, expect, it } from "vitest";

import { assessEvaluationQualityGate } from "../src/evaluation-quality-gate-assessment.js";
import {
  aggregateJudgeInvocationAttempts,
  judgeUsageAccountingFromInvocation,
} from "../src/evaluation-judge-accounting.js";
import { loadEvaluationRunUsageMeasurement } from "../src/evaluation-run-usage-loader.js";
import { EvaluationCaseResult } from "../src/evaluation-case-result.js";
import { ModelProfileVersion } from "../src/model-profile-version.js";
import { EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION } from "@osva-ai/contracts";
import type {
  EvaluationCaseId,
  EvaluationCaseResultId,
  EvaluationRunId,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const MPV_ID =
  "mpv-accounting" as import("@osva-ai/contracts").ModelProfileVersionId;

function testProfileVersion(model: string): ModelProfileVersion {
  return ModelProfileVersion.create({
    id: MPV_ID,
    modelProfileId: "mp-1" as import("@osva-ai/contracts").ModelProfileId,
    version: 1,
    provider: "OPENAI",
    model,
    pricing: {
      currency: "USD",
      inputUsdMicrosPerMillionTokens: 1_000_000,
      outputUsdMicrosPerMillionTokens: 2_000_000,
    },
    createdAt: NOW,
  });
}

describe("evaluation judge accounting", () => {
  it("marks unpriced calls when provider model identity is ineligible", () => {
    const record = judgeUsageAccountingFromInvocation(
      testProfileVersion("gpt-4o"),
      MPV_ID,
      {
        inputTokens: 1000,
        outputTokens: 200,
        providerReportedModelId: "claude-3",
        configuredProviderModelId: "gpt-4o",
      },
      1,
      "completed",
    );
    expect(record.unpricedModelCalls).toBe(1);
    expect(record.pricedCostUsdMicros).toBe(0);
  });

  it("aggregates multiple attempts without losing billed attempts", () => {
    const first = judgeUsageAccountingFromInvocation(
      testProfileVersion("gpt-4o"),
      MPV_ID,
      { inputTokens: 100, outputTokens: 50, providerReportedModelId: "gpt-4o" },
      1,
      "provider_error",
    );
    const second = judgeUsageAccountingFromInvocation(
      testProfileVersion("gpt-4o"),
      MPV_ID,
      { inputTokens: 200, outputTokens: 80, providerReportedModelId: "gpt-4o" },
      2,
      "completed",
    );
    const aggregate = aggregateJudgeInvocationAttempts(MPV_ID, [first, second]);
    expect(aggregate.judgeUsageAccounting.inputTokens).toBe(300);
    expect(aggregate.judgeUsageAccounting.outputTokens).toBe(130);
    expect(aggregate.judgeInvocationAttempts).toHaveLength(2);
  });

  it("treats missing usage as incomplete without fabricating cost", () => {
    const record = judgeUsageAccountingFromInvocation(
      testProfileVersion("gpt-4o"),
      MPV_ID,
      {},
      1,
      "completed",
    );
    expect(record.usageIncomplete).toBe(true);
    expect(record.unpricedModelCalls).toBe(1);
  });

  it("prices cached read tokens when rates exist", () => {
    const record = judgeUsageAccountingFromInvocation(
      ModelProfileVersion.create({
        id: MPV_ID,
        modelProfileId: "mp-1" as import("@osva-ai/contracts").ModelProfileId,
        version: 1,
        provider: "OPENAI",
        model: "gpt-4o",
        pricing: {
          currency: "USD",
          inputUsdMicrosPerMillionTokens: 1_000_000,
          outputUsdMicrosPerMillionTokens: 2_000_000,
          cachedReadInputUsdMicrosPerMillionTokens: 100_000,
        },
        createdAt: NOW,
      }),
      MPV_ID,
      {
        inputTokens: 1_000_000,
        outputTokens: 10,
        cachedInputTokens: 1_000_000,
        providerReportedModelId: "gpt-4o",
      },
      1,
      "completed",
    );
    expect(record.pricedCostUsdMicros).toBeGreaterThan(0);
    expect(record.unpricedModelCalls).toBe(0);
  });

  it("marks cache reads unpriced when tier pricing is missing", () => {
    const record = judgeUsageAccountingFromInvocation(
      testProfileVersion("gpt-4o"),
      MPV_ID,
      {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 1000,
        providerReportedModelId: "gpt-4o",
      },
      1,
      "completed",
    );
    expect(record.unpricedModelCalls).toBe(1);
  });

  it("records complete successful invocation usage", () => {
    const record = judgeUsageAccountingFromInvocation(
      testProfileVersion("gpt-4o"),
      MPV_ID,
      {
        inputTokens: 80,
        outputTokens: 20,
        providerReportedModelId: "gpt-4o",
      },
      1,
      "completed",
    );
    expect(record.usageIncomplete).toBe(false);
    expect(record.pricedCostUsdMicros).toBeGreaterThan(0);
    expect(record.unpricedModelCalls).toBe(0);
  });

  it("prices cache-write tokens when tier rate exists", () => {
    const record = judgeUsageAccountingFromInvocation(
      ModelProfileVersion.create({
        id: MPV_ID,
        modelProfileId: "mp-1" as import("@osva-ai/contracts").ModelProfileId,
        version: 1,
        provider: "OPENAI",
        model: "gpt-4o",
        pricing: {
          currency: "USD",
          inputUsdMicrosPerMillionTokens: 1_000_000,
          outputUsdMicrosPerMillionTokens: 2_000_000,
          cachedWriteInputUsdMicrosPerMillionTokens: 500_000,
        },
        createdAt: NOW,
      }),
      MPV_ID,
      {
        inputTokens: 2_000,
        outputTokens: 0,
        cacheWriteInputTokens: 2_000,
        providerReportedModelId: "gpt-4o",
      },
      1,
      "completed",
    );
    expect(record.pricedCostUsdMicros).toBeGreaterThan(0);
    expect(record.unpricedModelCalls).toBe(0);
  });

  it("marks cache-write unpriced when tier rate is missing", () => {
    const record = judgeUsageAccountingFromInvocation(
      testProfileVersion("gpt-4o"),
      MPV_ID,
      {
        inputTokens: 100,
        outputTokens: 0,
        cacheWriteInputTokens: 100,
        providerReportedModelId: "gpt-4o",
      },
      1,
      "completed",
    );
    expect(record.unpricedModelCalls).toBe(1);
    expect(record.pricedCostUsdMicros).toBe(0);
  });

  it("retains known usage on failed invocations", () => {
    const record = judgeUsageAccountingFromInvocation(
      testProfileVersion("gpt-4o"),
      MPV_ID,
      {
        inputTokens: 42,
        outputTokens: 9,
        providerReportedModelId: "gpt-4o",
      },
      1,
      "provider_error",
    );
    expect(record.inputTokens).toBe(42);
    expect(record.outputTokens).toBe(9);
  });

  it("deduplicates duplicate attempt numbers when aggregating", () => {
    const attempt = judgeUsageAccountingFromInvocation(
      testProfileVersion("gpt-4o"),
      MPV_ID,
      { inputTokens: 100, outputTokens: 1, providerReportedModelId: "gpt-4o" },
      1,
      "completed",
    );
    const duplicate = { ...attempt, inputTokens: 9_999 };
    const aggregate = aggregateJudgeInvocationAttempts(MPV_ID, [
      attempt,
      duplicate,
    ]);
    expect(aggregate.judgeUsageAccounting.inputTokens).toBe(100);
    expect(aggregate.judgeInvocationAttempts).toHaveLength(1);
  });

  it("aggregates retried success with both billable attempts", () => {
    const first = judgeUsageAccountingFromInvocation(
      testProfileVersion("gpt-4o"),
      MPV_ID,
      { inputTokens: 30, outputTokens: 10, providerReportedModelId: "gpt-4o" },
      1,
      "provider_error",
    );
    const second = judgeUsageAccountingFromInvocation(
      testProfileVersion("gpt-4o"),
      MPV_ID,
      { inputTokens: 40, outputTokens: 15, providerReportedModelId: "gpt-4o" },
      2,
      "completed",
    );
    const aggregate = aggregateJudgeInvocationAttempts(MPV_ID, [first, second]);
    expect(aggregate.judgeUsageAccounting.inputTokens).toBe(70);
    expect(aggregate.judgeInvocationAttempts).toHaveLength(2);
  });

  it("merges target and judge usage categories for evaluation runs", async () => {
    const ws = "ws-usage" as WorkspaceId;
    const runId = "run-child" as RunId;
    const evaluationRun = {
      id: "er-1" as EvaluationRunId,
      workspaceId: ws,
      status: "COMPLETED",
      createdAt: NOW,
      updatedAt: NOW,
      startedAt: NOW,
      completedAt: NOW,
      evaluationSuiteVersionId: "esv-1" as never,
      targetType: "AGENT_VERSION",
      targetVersionId: "av-1" as never,
    };
    const caseResult = EvaluationCaseResult.create({
      id: "cr-1" as EvaluationCaseResultId,
      evaluationRunId: evaluationRun.id,
      evaluationCaseId: "ec-1" as EvaluationCaseId,
      runId,
      outcome: "PASS",
      evaluatorResults: {
        type: "LLM_JUDGE",
        status: "COMPLETED",
        score: 1,
        passed: true,
        judgeUsageAccounting: {
          role: "judge",
          inputTokens: 50,
          outputTokens: 10,
          pricedCostUsdMicros: 100,
          unpricedModelCalls: 0,
          usageMeasured: true,
        },
      },
      createdAt: NOW,
      completedAt: NOW,
    });
    const runs = {
      findRunByWorkspaceAndId: async () => ({ id: runId }),
      listRunAttemptsForRuns: async () => [
        { id: "ra-1" as never, runId, sequence: 1, status: "SUCCEEDED" },
      ],
      aggregateRunAttemptUsageBatch: async () => ({
        modelCalls: 1,
        toolCalls: 0,
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        estimatedCostUsdMicros: 500,
        pricedModelCalls: 1,
        unpricedModelCalls: 0,
      }),
    };
    const merged = await loadEvaluationRunUsageMeasurement(
      runs as never,
      ws,
      evaluationRun as never,
      [caseResult],
    );
    expect(merged.inputTokens).toBe(250);
    expect(merged.pricedCostUsdMicros).toBe(600);
    expect(merged.usageMeasured).toBe(true);
  });

  it("does not allow cost gate PASS when unpriced judge calls remain", () => {
    const assessment = assessEvaluationQualityGate({
      policy: {
        schemaVersion: EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
        rules: [
          {
            metric: "ESTIMATED_COST_USD_MICROS",
            operator: "MAX",
            threshold: 1,
          },
        ],
      },
      evaluationRunStatus: "COMPLETED",
      summary: {
        totalCases: 1,
        pendingCases: 0,
        runningCases: 0,
        completedCases: 1,
        passedCases: 1,
        failedCases: 0,
        errorCases: 0,
        passRate: 1,
        completionCoverage: 1,
        validScoredCaseCount: 1,
        usageMeasured: true,
        inputTokens: 100,
        outputTokens: 50,
        pricedCostUsdMicros: 0,
        unpricedModelCalls: 1,
      },
      assessedAt: NOW,
      allowFinalPass: true,
    });
    expect(assessment.overallVerdict).not.toBe("PASS");
  });
});
