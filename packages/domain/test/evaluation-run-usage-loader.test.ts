import type {
  EvaluationCaseId,
  EvaluationCaseResultId,
  EvaluationRunId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { EvaluationCaseResult } from "../src/evaluation-case-result.js";
import { RunNotFoundError } from "../src/errors.js";
import { EvaluationRun } from "../src/evaluation-run.js";
import { Run } from "../src/run.js";
import { isMeasurableModelRunStep } from "../src/evaluation-run-usage.js";
import { RunAttempt } from "../src/run-attempt.js";
import { RunStep } from "../src/run-step.js";
import { loadEvaluationRunUsageMeasurement } from "../src/evaluation-run-usage-loader.js";
import type {
  RunAttemptUsageSummary,
  RunRepository,
} from "../src/ports/run-repository.js";
import {
  agentId,
  createBindings,
  modelProfileVersionId,
  RUN_INPUT,
} from "./fixtures.js";

const workspaceId = "ws-1" as WorkspaceId;
const otherWorkspaceId = "ws-2" as WorkspaceId;

class UsageLoaderRunRepository implements Partial<RunRepository> {
  readonly runs = new Map<RunId, Run>();
  readonly attempts = new Map<RunAttemptId, RunAttempt>();
  readonly steps: RunStep[] = [];

  addRun(run: Run): void {
    this.runs.set(run.id, run);
  }

  addAttempt(attempt: RunAttempt): void {
    this.attempts.set(attempt.id, attempt);
  }

  addModelStep(options: {
    readonly runAttemptId: RunAttemptId;
    readonly runId: RunId;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostUsdMicros?: number | null;
  }): void {
    const startedAt = new Date("2026-01-01T00:00:01.000Z");
    const step = RunStep.create({
      id: `step-${String(this.steps.length + 1)}` as import("@osva-ai/contracts").RunStepId,
      runId: options.runId,
      runAttemptId: options.runAttemptId,
      kind: "MODEL",
      bindingName: "default",
      modelProfileVersionId,
      status: "SUCCEEDED",
      startedAt,
      completedAt: new Date("2026-01-01T00:00:02.000Z"),
      inputTokens: options.inputTokens,
      outputTokens: options.outputTokens,
      totalTokens: options.inputTokens + options.outputTokens,
      estimatedCostUsdMicros: options.estimatedCostUsdMicros ?? null,
    });
    this.steps.push(step);
  }

  async findRunByWorkspaceAndId(
    queryWorkspaceId: WorkspaceId,
    runId: RunId,
  ): Promise<Run | null> {
    const run = this.runs.get(runId);
    if (run === undefined || run.workspaceId !== queryWorkspaceId) {
      return null;
    }
    return run;
  }

  async listRunAttemptsForRuns(
    runIds: readonly RunId[],
  ): Promise<readonly RunAttempt[]> {
    const runIdSet = new Set(runIds);
    return [...this.attempts.values()].filter((attempt) =>
      runIdSet.has(attempt.runId),
    );
  }

  async aggregateRunAttemptUsageBatch(
    runAttemptIds: readonly RunAttemptId[],
  ): Promise<RunAttemptUsageSummary> {
    const attemptIdSet = new Set(runAttemptIds);
    let inputTokens = 0;
    let outputTokens = 0;
    let pricedCostUsdMicros = 0;
    let unpricedModelCalls = 0;
    let hasPriced = false;

    for (const step of this.steps) {
      if (
        !attemptIdSet.has(step.runAttemptId) ||
        !isMeasurableModelRunStep(step)
      ) {
        continue;
      }
      inputTokens += step.inputTokens ?? 0;
      outputTokens += step.outputTokens ?? 0;
      if (
        step.estimatedCostUsdMicros === null ||
        step.estimatedCostUsdMicros === undefined
      ) {
        unpricedModelCalls += 1;
      } else {
        hasPriced = true;
        pricedCostUsdMicros += step.estimatedCostUsdMicros;
      }
    }

    let modelCalls = 0;
    for (const step of this.steps) {
      if (
        !attemptIdSet.has(step.runAttemptId) ||
        step.status !== "SUCCEEDED" ||
        step.kind !== "MODEL"
      ) {
        continue;
      }
      modelCalls += 1;
    }

    return {
      modelCalls,
      toolCalls: 0,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cachedInputTokens: 0,
      estimatedCostUsdMicros: hasPriced ? pricedCostUsdMicros : null,
      pricedModelCalls: modelCalls - unpricedModelCalls,
      unpricedModelCalls,
    };
  }
}

function evaluationRun(): EvaluationRun {
  return EvaluationRun.rehydrate({
    id: "er-1" as EvaluationRunId,
    workspaceId,
    evaluationSuiteVersionId:
      "esv-1" as import("@osva-ai/contracts").EvaluationSuiteVersionId,
    targetType: "AGENT_VERSION",
    targetVersionId: "av-1",
    status: "RUNNING",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

function caseResult(runId: RunId): EvaluationCaseResult {
  return EvaluationCaseResult.create({
    id: "ecr-1" as EvaluationCaseResultId,
    evaluationRunId: "er-1" as EvaluationRunId,
    evaluationCaseId: "case-1" as EvaluationCaseId,
    runId,
    outcome: "PASS",
    evaluatorResults: {},
    createdAt: new Date("2026-01-01T00:00:03.000Z"),
    completedAt: new Date("2026-01-01T00:00:03.000Z"),
  });
}

describe("loadEvaluationRunUsageMeasurement", () => {
  it("returns unmeasured usage when there are no reconciled cases", async () => {
    const repo = new UsageLoaderRunRepository();
    const measurement = await loadEvaluationRunUsageMeasurement(
      repo as unknown as RunRepository,
      workspaceId,
      evaluationRun(),
      [],
    );

    expect(measurement.usageMeasured).toBe(false);
  });

  it("aggregates usage from the billing attempt without double-counting retries", async () => {
    const repo = new UsageLoaderRunRepository();
    const runId = "run-1" as RunId;
    repo.addRun(
      Run.rehydrate({
        id: runId,
        workspaceId,
        agentId,
        status: "SUCCEEDED",
        effectiveBindings: createBindings(),
        input: RUN_INPUT,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:03.000Z"),
      }),
    );

    const failedAttempt = RunAttempt.rehydrate({
      id: "attempt-1" as RunAttemptId,
      runId,
      sequence: 1,
      status: "FAILED",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      completedAt: new Date("2026-01-01T00:00:01.000Z"),
    });
    const billingAttempt = RunAttempt.rehydrate({
      id: "attempt-2" as RunAttemptId,
      runId,
      sequence: 2,
      status: "SUCCEEDED",
      createdAt: new Date("2026-01-01T00:00:01.000Z"),
      completedAt: new Date("2026-01-01T00:00:03.000Z"),
    });
    repo.addAttempt(failedAttempt);
    repo.addAttempt(billingAttempt);
    repo.addModelStep({
      runId,
      runAttemptId: "attempt-1" as RunAttemptId,
      inputTokens: 999,
      outputTokens: 999,
      estimatedCostUsdMicros: 999,
    });
    repo.addModelStep({
      runId,
      runAttemptId: "attempt-2" as RunAttemptId,
      inputTokens: 10,
      outputTokens: 5,
      estimatedCostUsdMicros: 100,
    });

    const measurement = await loadEvaluationRunUsageMeasurement(
      repo as unknown as RunRepository,
      workspaceId,
      evaluationRun(),
      [caseResult(runId)],
    );

    expect(measurement).toMatchObject({
      inputTokens: 1009,
      outputTokens: 1004,
      pricedCostUsdMicros: 1099,
      unpricedModelCalls: 0,
      usageMeasured: true,
    });
    expect(measurement.durationMs).toBeUndefined();
  });

  it("reports measured zero usage when no model steps exist", async () => {
    const repo = new UsageLoaderRunRepository();
    const runId = "run-1" as RunId;
    repo.addRun(
      Run.rehydrate({
        id: runId,
        workspaceId,
        agentId,
        status: "SUCCEEDED",
        effectiveBindings: createBindings(),
        input: RUN_INPUT,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:03.000Z"),
      }),
    );
    repo.addAttempt(
      RunAttempt.rehydrate({
        id: "attempt-1" as RunAttemptId,
        runId,
        sequence: 1,
        status: "SUCCEEDED",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: new Date("2026-01-01T00:00:03.000Z"),
      }),
    );

    const measurement = await loadEvaluationRunUsageMeasurement(
      repo as unknown as RunRepository,
      workspaceId,
      evaluationRun(),
      [caseResult(runId)],
    );

    expect(measurement).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      pricedCostUsdMicros: 0,
      unpricedModelCalls: 0,
      usageMeasured: true,
    });
  });

  it("throws when the run is outside the workspace", async () => {
    const repo = new UsageLoaderRunRepository();
    const runId = "run-1" as RunId;
    repo.addRun(
      Run.rehydrate({
        id: runId,
        workspaceId: otherWorkspaceId,
        agentId,
        status: "SUCCEEDED",
        effectiveBindings: createBindings(),
        input: RUN_INPUT,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:03.000Z"),
      }),
    );

    await expect(
      loadEvaluationRunUsageMeasurement(
        repo as unknown as RunRepository,
        workspaceId,
        evaluationRun(),
        [caseResult(runId)],
      ),
    ).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("counts unpriced model calls separately from priced subtotals", async () => {
    const repo = new UsageLoaderRunRepository();
    const runId = "run-1" as RunId;
    repo.addRun(
      Run.rehydrate({
        id: runId,
        workspaceId,
        agentId,
        status: "SUCCEEDED",
        effectiveBindings: createBindings(),
        input: RUN_INPUT,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:03.000Z"),
      }),
    );
    repo.addAttempt(
      RunAttempt.rehydrate({
        id: "attempt-1" as RunAttemptId,
        runId,
        sequence: 1,
        status: "SUCCEEDED",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: new Date("2026-01-01T00:00:03.000Z"),
      }),
    );
    repo.addModelStep({
      runId,
      runAttemptId: "attempt-1" as RunAttemptId,
      inputTokens: 1,
      outputTokens: 1,
      estimatedCostUsdMicros: 50,
    });
    repo.addModelStep({
      runId,
      runAttemptId: "attempt-1" as RunAttemptId,
      inputTokens: 2,
      outputTokens: 2,
      estimatedCostUsdMicros: null,
    });

    const measurement = await loadEvaluationRunUsageMeasurement(
      repo as unknown as RunRepository,
      workspaceId,
      evaluationRun(),
      [caseResult(runId)],
    );

    expect(measurement).toMatchObject({
      inputTokens: 3,
      outputTokens: 3,
      pricedCostUsdMicros: 50,
      unpricedModelCalls: 1,
      usageMeasured: true,
    });
  });
});
