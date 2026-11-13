import type {
  AssignmentId,
  GoalId,
  OfficeWorkerId,
  RunAttemptId,
  RunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import type { RunAttemptUsageSummary } from "../src/ports/run-repository.js";
import {
  collectDistinctRunIdsForOfficeTasks,
  collectOfficeTaskRunAttribution,
  collectRunAttemptIdsForOfficeUsage,
  computeTerminalTaskSuccessRate,
  measureAssignmentDurationMs,
  mergeOfficeUsageSummaries,
  rankWorkersByActiveTasks,
  summarizeDurationStatistics,
  summarizeMissionPerformance,
  summarizeTaskExecution,
  summarizeTeamPerformance,
  summarizeWorkerPerformance,
  type OfficeObservabilityAssignmentRecord,
} from "../src/office-observability-projection.js";

const ws = "ws-1" as WorkspaceId;
const workerA = "ow-a" as OfficeWorkerId;
const workerB = "ow-b" as OfficeWorkerId;
const goal = "goal-1" as GoalId;

function task(
  partial: Partial<OfficeObservabilityAssignmentRecord> & {
    readonly id: AssignmentId;
  },
): OfficeObservabilityAssignmentRecord {
  return {
    id: partial.id,
    workspaceId: partial.workspaceId ?? ws,
    officeWorkerId: partial.officeWorkerId ?? workerA,
    goalId: partial.goalId,
    status: partial.status ?? "PENDING",
    runId: partial.runId,
    workflowRunId: partial.workflowRunId,
    startedAt: partial.startedAt,
    completedAt: partial.completedAt,
    cancelledAt: partial.cancelledAt,
  };
}

function usageSummary(
  partial: Partial<RunAttemptUsageSummary>,
): RunAttemptUsageSummary {
  return {
    modelCalls: partial.modelCalls ?? 0,
    toolCalls: partial.toolCalls ?? 0,
    inputTokens: partial.inputTokens ?? 0,
    outputTokens: partial.outputTokens ?? 0,
    totalTokens: partial.totalTokens ?? 0,
    cachedInputTokens: partial.cachedInputTokens ?? 0,
    estimatedCostUsdMicros:
      partial.estimatedCostUsdMicros === undefined
        ? null
        : partial.estimatedCostUsdMicros,
    pricedModelCalls: partial.pricedModelCalls ?? 0,
    unpricedModelCalls: partial.unpricedModelCalls ?? 0,
  };
}

describe("office observability projection", () => {
  it("returns empty workspace task summary", () => {
    expect(summarizeTaskExecution([], ws)).toMatchObject({
      total: 0,
      terminalSuccessRate: null,
      terminalDenominator: 0,
      duration: { measuredCount: 0, totalDurationMs: 0 },
    });
  });

  it("counts all-pending tasks without terminal success rate", () => {
    const summary = summarizeTaskExecution(
      [
        task({ id: "a1" as AssignmentId, status: "PENDING" }),
        task({ id: "a2" as AssignmentId, status: "PENDING" }),
      ],
      ws,
    );
    expect(summary.pending).toBe(2);
    expect(summary.terminalSuccessRate).toBeNull();
    expect(summary.terminalDenominator).toBe(0);
  });

  it("aggregates mixed terminal outcomes", () => {
    const summary = summarizeTaskExecution(
      [
        task({ id: "c1" as AssignmentId, status: "COMPLETED" }),
        task({ id: "f1" as AssignmentId, status: "FAILED" }),
        task({ id: "x1" as AssignmentId, status: "CANCELLED" }),
        task({ id: "r1" as AssignmentId, status: "RUNNING" }),
      ],
      ws,
    );
    expect(summary).toMatchObject({
      completed: 1,
      failed: 1,
      cancelled: 1,
      running: 1,
      terminalDenominator: 3,
    });
    expect(summary.terminalSuccessRate).toBeCloseTo(1 / 3);
  });

  it("defines terminal success rate denominator with cancelled included", () => {
    const { rate, denominator } = computeTerminalTaskSuccessRate({
      completed: 2,
      failed: 1,
      cancelled: 1,
    });
    expect(denominator).toBe(4);
    expect(rate).toBe(0.5);
  });

  it("omits duration when timestamps are missing", () => {
    expect(
      measureAssignmentDurationMs(
        task({ id: "a1" as AssignmentId, status: "COMPLETED" }),
      ),
    ).toBeUndefined();
    expect(
      measureAssignmentDurationMs(
        task({
          id: "a2" as AssignmentId,
          status: "FAILED",
          startedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ),
    ).toBeUndefined();
  });

  it("rejects invalid duration evidence", () => {
    expect(
      measureAssignmentDurationMs(
        task({
          id: "a1" as AssignmentId,
          status: "COMPLETED",
          startedAt: new Date("2026-01-02T00:00:00.000Z"),
          completedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ),
    ).toBeUndefined();
  });

  it("measures completed and cancelled durations", () => {
    const completedMs = measureAssignmentDurationMs(
      task({
        id: "c1" as AssignmentId,
        status: "COMPLETED",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: new Date("2026-01-01T00:10:00.000Z"),
      }),
    );
    expect(completedMs).toBe(600_000);
    const cancelledMs = measureAssignmentDurationMs(
      task({
        id: "x1" as AssignmentId,
        status: "CANCELLED",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        cancelledAt: new Date("2026-01-01T00:05:00.000Z"),
      }),
    );
    expect(cancelledMs).toBe(300_000);
  });

  it("summarizes duration statistics", () => {
    const stats = summarizeDurationStatistics([100, 300, 200]);
    expect(stats).toEqual({
      measuredCount: 3,
      totalDurationMs: 600,
      minDurationMs: 100,
      maxDurationMs: 300,
      medianDurationMs: 200,
    });
  });

  it("attributes worker tasks by officeWorkerId", () => {
    const summary = summarizeWorkerPerformance(workerA, [
      task({
        id: "a1" as AssignmentId,
        officeWorkerId: workerA,
        status: "COMPLETED",
      }),
      task({
        id: "a2" as AssignmentId,
        officeWorkerId: workerB,
        status: "COMPLETED",
      }),
    ]);
    expect(summary.assignedTaskCount).toBe(1);
    expect(summary.completed).toBe(1);
  });

  it("summarizes team tasks for current members only", () => {
    const summary = summarizeTeamPerformance(
      "team-1",
      [workerA],
      [
        task({ id: "a1" as AssignmentId, officeWorkerId: workerA }),
        task({ id: "a2" as AssignmentId, officeWorkerId: workerB }),
      ],
    );
    expect(summary.distinctAssignedTaskCount).toBe(1);
    expect(summary.memberWorkerIds).toEqual([workerA]);
  });

  it("handles worker membership in multiple teams independently", () => {
    const assignments = [
      task({ id: "a1" as AssignmentId, officeWorkerId: workerA }),
    ];
    const teamOne = summarizeTeamPerformance("team-1", [workerA], assignments);
    const teamTwo = summarizeTeamPerformance("team-2", [workerA], assignments);
    expect(teamOne.distinctAssignedTaskCount).toBe(1);
    expect(teamTwo.distinctAssignedTaskCount).toBe(1);
  });

  it("collects mission metrics without changing goal semantics", () => {
    const mission = summarizeMissionPerformance(goal, [
      task({ id: "a1" as AssignmentId, goalId: goal, status: "COMPLETED" }),
      task({ id: "a2" as AssignmentId, status: "PENDING" }),
    ]);
    expect(mission.linkedTaskCount).toBe(1);
    expect(mission.completionRatio).toBe(1);
  });

  it("deduplicates workflow child runs across node records", () => {
    const wf = "wfr-1" as WorkflowRunId;
    const child = "run-child" as RunId;
    const map = new Map<WorkflowRunId, readonly RunId[]>([
      [wf, [child, child]],
    ]);
    const runs = collectDistinctRunIdsForOfficeTasks(
      [
        task({
          id: "a1" as AssignmentId,
          workflowRunId: wf,
        }),
      ],
      map,
    );
    expect(runs).toEqual([child]);
  });

  it("uses agent runId attribution without workflow children", () => {
    const runId = "run-1" as RunId;
    const attribution = collectOfficeTaskRunAttribution(
      task({
        id: "a1" as AssignmentId,
        runId,
      }),
    );
    expect(attribution).toEqual({
      assignmentId: "a1",
      runIds: [runId],
      kind: "agent_run",
    });
  });

  it("marks workflow tasks without child run index as unattributed usage", () => {
    const attribution = collectOfficeTaskRunAttribution(
      task({
        id: "a1" as AssignmentId,
        workflowRunId: "wfr-1" as WorkflowRunId,
      }),
    );
    expect(attribution.kind).toBe("none");
    expect(attribution.runIds).toEqual([]);
  });

  it("collects run attempts without duplicate ids for retries", () => {
    const runId = "run-1" as RunId;
    const first = "att-1" as RunAttemptId;
    const second = "att-2" as RunAttemptId;
    const attemptIds = collectRunAttemptIdsForOfficeUsage(
      [
        { id: first, runId },
        { id: second, runId },
        { id: second, runId },
      ],
      [runId],
    );
    expect(attemptIds).toEqual([first, second]);
  });

  it("merges priced usage and preserves partial cost disclosure", () => {
    const merged = mergeOfficeUsageSummaries([
      usageSummary({
        estimatedCostUsdMicros: 1000,
        pricedModelCalls: 1,
        inputTokens: 10,
        modelCalls: 1,
      }),
      usageSummary({
        estimatedCostUsdMicros: null,
        unpricedModelCalls: 2,
        modelCalls: 2,
      }),
    ]);
    expect(merged.estimatedCostUsdMicros).toBe(1000);
    expect(merged.unpricedModelCalls).toBe(2);
    expect(merged.costCoverage).toBe("priced_partial");
    expect(merged.usageMeasured).toBe(true);
  });

  it("keeps unknown cost distinct from zero", () => {
    const merged = mergeOfficeUsageSummaries([
      usageSummary({ unpricedModelCalls: 1, modelCalls: 1 }),
    ]);
    expect(merged.estimatedCostUsdMicros).toBeNull();
    expect(merged.costCoverage).toBe("partial");
  });

  it("treats genuine zero priced coverage as complete measured usage", () => {
    const merged = mergeOfficeUsageSummaries([
      usageSummary({
        estimatedCostUsdMicros: 0,
        pricedModelCalls: 1,
        modelCalls: 1,
      }),
    ]);
    expect(merged.estimatedCostUsdMicros).toBe(0);
    expect(merged.costCoverage).toBe("complete");
  });

  it("rejects cross-workspace aggregation", () => {
    expect(() =>
      summarizeTaskExecution(
        [
          task({
            id: "a1" as AssignmentId,
            workspaceId: "ws-2" as WorkspaceId,
          }),
        ],
        ws,
      ),
    ).toThrow(/workspace boundary/);
  });

  it("ranks workers by active task load", () => {
    const ranked = rankWorkersByActiveTasks([
      task({
        id: "a1" as AssignmentId,
        officeWorkerId: workerA,
        status: "RUNNING",
      }),
      task({
        id: "a2" as AssignmentId,
        officeWorkerId: workerA,
        status: "PENDING",
      }),
      task({
        id: "a3" as AssignmentId,
        officeWorkerId: workerB,
        status: "RUNNING",
      }),
      task({
        id: "a4" as AssignmentId,
        officeWorkerId: workerB,
        status: "COMPLETED",
      }),
    ]);
    expect(ranked[0]?.officeWorkerId).toBe(workerA);
    expect(ranked[0]?.active).toBe(2);
  });
});
