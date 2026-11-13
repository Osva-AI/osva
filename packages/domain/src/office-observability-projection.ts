import type {
  AssignmentId,
  AssignmentState,
  GoalId,
  OfficeWorkerId,
  RunAttemptId,
  RunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";

import { mergeRunAttemptUsageSummaries } from "./evaluation-run-usage.js";
import type { RunAttemptUsageSummary } from "./ports/run-repository.js";

/**
 * Canonical Office Task (Assignment) fields for observability aggregation.
 * Timestamps use Date objects; Console adapters parse ISO strings at the boundary.
 */
export interface OfficeObservabilityAssignmentRecord {
  readonly id: AssignmentId;
  readonly workspaceId: WorkspaceId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly goalId?: GoalId;
  readonly status: AssignmentState;
  readonly runId?: RunId;
  readonly workflowRunId?: WorkflowRunId;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly cancelledAt?: Date;
}

export const TERMINAL_ASSIGNMENT_STATUSES = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type TerminalAssignmentStatus =
  (typeof TERMINAL_ASSIGNMENT_STATUSES)[number];

export function isTerminalAssignmentStatus(
  status: string,
): status is TerminalAssignmentStatus {
  return (TERMINAL_ASSIGNMENT_STATUSES as readonly string[]).includes(status);
}

export interface DurationStatistics {
  /** Assignments with a measured positive duration. */
  readonly measuredCount: number;
  readonly totalDurationMs: number;
  readonly minDurationMs?: number;
  readonly maxDurationMs?: number;
  readonly medianDurationMs?: number;
}

export interface TaskExecutionSummary {
  readonly total: number;
  readonly pending: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly active: number;
  /**
   * COMPLETED / (COMPLETED + FAILED + CANCELLED).
   * Cancelled tasks count toward the denominator only.
   * Null when there are no terminal tasks.
   */
  readonly terminalSuccessRate: number | null;
  readonly terminalDenominator: number;
  readonly duration: DurationStatistics;
}

export interface WorkerPerformanceSummary extends TaskExecutionSummary {
  readonly officeWorkerId: OfficeWorkerId;
  readonly assignedTaskCount: number;
  readonly completionRate: number | null;
}

export interface TeamPerformanceSummary extends TaskExecutionSummary {
  readonly teamId: string;
  /** Current member worker ids supplied by the caller. */
  readonly memberWorkerIds: readonly OfficeWorkerId[];
  /**
   * Distinct assignments owned by a current member (`Assignment.officeWorkerId`).
   * Overlapping team membership may reference the same task from multiple teams.
   */
  readonly distinctAssignedTaskCount: number;
}

export interface MissionPerformanceSummary extends TaskExecutionSummary {
  readonly goalId: GoalId;
  readonly linkedTaskCount: number;
  readonly completionRatio: number | null;
  readonly verifiedDeliverablesCount?: number | null;
}

export type OfficeUsageCostCoverage =
  "unmeasured" | "partial" | "priced_partial" | "complete";

export interface OfficeUsageAggregate {
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens: number;
  readonly pricedModelCalls: number;
  readonly unpricedModelCalls: number;
  /**
   * Sum of known priced attempt estimates in integer micro-USD.
   * Null when no priced portions exist (including genuine zero spend with coverage).
   */
  readonly estimatedCostUsdMicros: number | null;
  readonly costCoverage: OfficeUsageCostCoverage;
  readonly usageMeasured: boolean;
  readonly attemptCount: number;
}

export interface OfficeTaskRunAttribution {
  readonly assignmentId: AssignmentId;
  readonly runIds: readonly RunId[];
  readonly kind: "agent_run" | "workflow_child_runs" | "none";
}

const EMPTY_DURATION: DurationStatistics = {
  measuredCount: 0,
  totalDurationMs: 0,
};

/**
 * Measures wall duration for terminal tasks when both endpoints exist.
 * Does not infer end times from `updatedAt`. Non-terminal tasks return undefined.
 */
export function measureAssignmentDurationMs(
  assignment: OfficeObservabilityAssignmentRecord,
): number | undefined {
  const startedAt = assignment.startedAt;
  if (startedAt === undefined) {
    return undefined;
  }
  const startMs = startedAt.getTime();
  if (Number.isNaN(startMs)) {
    return undefined;
  }

  let end: Date | undefined;
  switch (assignment.status) {
    case "COMPLETED":
      end = assignment.completedAt;
      break;
    case "CANCELLED":
      end = assignment.cancelledAt;
      break;
    case "FAILED":
      end = assignment.completedAt;
      break;
    default:
      return undefined;
  }

  if (end === undefined) {
    return undefined;
  }
  const endMs = end.getTime();
  if (Number.isNaN(endMs) || endMs < startMs) {
    return undefined;
  }
  const duration = endMs - startMs;
  return duration > 0 ? duration : undefined;
}

export function summarizeDurationStatistics(
  durationsMs: readonly number[],
): DurationStatistics {
  const positive = durationsMs.filter((value) => value > 0);
  if (positive.length === 0) {
    return EMPTY_DURATION;
  }
  const sorted = [...positive].sort((left, right) => left - right);
  const totalDurationMs = sorted.reduce((sum, value) => sum + value, 0);
  const mid = Math.floor(sorted.length / 2);
  const medianDurationMs =
    sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
      : sorted[mid];

  return {
    measuredCount: sorted.length,
    totalDurationMs,
    minDurationMs: sorted[0],
    maxDurationMs: sorted[sorted.length - 1],
    medianDurationMs,
  };
}

export function computeTerminalTaskSuccessRate(summary: {
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
}): { readonly rate: number | null; readonly denominator: number } {
  const denominator = summary.completed + summary.failed + summary.cancelled;
  if (denominator === 0) {
    return { rate: null, denominator: 0 };
  }
  return { rate: summary.completed / denominator, denominator };
}

function assertWorkspace(
  assignments: readonly OfficeObservabilityAssignmentRecord[],
  workspaceId: WorkspaceId,
): void {
  for (const assignment of assignments) {
    if (assignment.workspaceId !== workspaceId) {
      throw new Error(
        `Office observability aggregation crossed workspace boundary at assignment '${assignment.id}'.`,
      );
    }
  }
}

function countByStatus(
  assignments: readonly OfficeObservabilityAssignmentRecord[],
): Omit<
  TaskExecutionSummary,
  "terminalSuccessRate" | "terminalDenominator" | "duration"
> {
  let pending = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  for (const assignment of assignments) {
    switch (assignment.status) {
      case "PENDING":
        pending += 1;
        break;
      case "RUNNING":
        running += 1;
        break;
      case "COMPLETED":
        completed += 1;
        break;
      case "FAILED":
        failed += 1;
        break;
      case "CANCELLED":
        cancelled += 1;
        break;
      default:
        break;
    }
  }
  const total = assignments.length;
  return {
    total,
    pending,
    running,
    completed,
    failed,
    cancelled,
    active: pending + running,
  };
}

function buildTaskExecutionSummary(
  assignments: readonly OfficeObservabilityAssignmentRecord[],
): TaskExecutionSummary {
  const counts = countByStatus(assignments);
  const { rate, denominator } = computeTerminalTaskSuccessRate(counts);
  const durations = assignments
    .map((assignment) => measureAssignmentDurationMs(assignment))
    .filter((value): value is number => value !== undefined);
  return {
    ...counts,
    terminalSuccessRate: rate,
    terminalDenominator: denominator,
    duration: summarizeDurationStatistics(durations),
  };
}

export function summarizeTaskExecution(
  assignments: readonly OfficeObservabilityAssignmentRecord[],
  workspaceId?: WorkspaceId,
): TaskExecutionSummary {
  if (workspaceId !== undefined) {
    assertWorkspace(assignments, workspaceId);
  }
  const scoped =
    workspaceId === undefined
      ? assignments
      : assignments.filter(
          (assignment) => assignment.workspaceId === workspaceId,
        );
  return buildTaskExecutionSummary(scoped);
}

export function summarizeWorkerPerformance(
  officeWorkerId: OfficeWorkerId,
  assignments: readonly OfficeObservabilityAssignmentRecord[],
  workspaceId?: WorkspaceId,
): WorkerPerformanceSummary {
  if (workspaceId !== undefined) {
    assertWorkspace(assignments, workspaceId);
  }
  const scoped = assignments.filter(
    (assignment) => assignment.officeWorkerId === officeWorkerId,
  );
  const base = buildTaskExecutionSummary(scoped);
  const completionRate = base.total === 0 ? null : base.completed / base.total;
  return {
    ...base,
    officeWorkerId,
    assignedTaskCount: base.total,
    completionRate,
  };
}

export function summarizeTeamPerformance(
  teamId: string,
  memberWorkerIds: readonly OfficeWorkerId[],
  assignments: readonly OfficeObservabilityAssignmentRecord[],
  workspaceId?: WorkspaceId,
): TeamPerformanceSummary {
  if (workspaceId !== undefined) {
    assertWorkspace(assignments, workspaceId);
  }
  const memberSet = new Set(memberWorkerIds);
  const distinctAssignments = assignments.filter((assignment) =>
    memberSet.has(assignment.officeWorkerId),
  );
  const base = buildTaskExecutionSummary(distinctAssignments);
  return {
    ...base,
    teamId,
    memberWorkerIds: [...memberWorkerIds],
    distinctAssignedTaskCount: base.total,
  };
}

export function summarizeMissionPerformance(
  goalId: GoalId,
  assignments: readonly OfficeObservabilityAssignmentRecord[],
  options?: { readonly verifiedDeliverablesCount?: number | null },
  workspaceId?: WorkspaceId,
): MissionPerformanceSummary {
  if (workspaceId !== undefined) {
    assertWorkspace(assignments, workspaceId);
  }
  const linked = assignments.filter(
    (assignment) => assignment.goalId === goalId,
  );
  const base = buildTaskExecutionSummary(linked);
  const completionRatio = base.total === 0 ? null : base.completed / base.total;
  return {
    ...base,
    goalId,
    linkedTaskCount: base.total,
    completionRatio,
    ...(options?.verifiedDeliverablesCount !== undefined
      ? { verifiedDeliverablesCount: options.verifiedDeliverablesCount }
      : {}),
  };
}

export function collectOfficeTaskRunAttribution(
  assignment: OfficeObservabilityAssignmentRecord,
  workflowChildRunIds?: readonly RunId[],
): OfficeTaskRunAttribution {
  if (assignment.runId !== undefined) {
    return {
      assignmentId: assignment.id,
      runIds: [assignment.runId],
      kind: "agent_run",
    };
  }
  if (
    assignment.workflowRunId !== undefined &&
    workflowChildRunIds !== undefined &&
    workflowChildRunIds.length > 0
  ) {
    return {
      assignmentId: assignment.id,
      runIds: uniqueRunIds(workflowChildRunIds),
      kind: "workflow_child_runs",
    };
  }
  return {
    assignmentId: assignment.id,
    runIds: [],
    kind: "none",
  };
}

export function collectDistinctRunIdsForOfficeTasks(
  assignments: readonly OfficeObservabilityAssignmentRecord[],
  workflowChildRunIdsByWorkflowRunId?: ReadonlyMap<
    WorkflowRunId,
    readonly RunId[]
  >,
): readonly RunId[] {
  const runIds: RunId[] = [];
  const seen = new Set<RunId>();
  for (const assignment of assignments) {
    const childRuns =
      assignment.workflowRunId !== undefined
        ? workflowChildRunIdsByWorkflowRunId?.get(assignment.workflowRunId)
        : undefined;
    const attribution = collectOfficeTaskRunAttribution(assignment, childRuns);
    for (const runId of attribution.runIds) {
      if (seen.has(runId)) {
        continue;
      }
      seen.add(runId);
      runIds.push(runId);
    }
  }
  return runIds;
}

export function collectRunAttemptIdsForOfficeUsage(
  attempts: readonly { readonly id: RunAttemptId; readonly runId: RunId }[],
  runIds: readonly RunId[],
): readonly RunAttemptId[] {
  const runIdSet = new Set(runIds);
  const seen = new Set<RunAttemptId>();
  const selected: RunAttemptId[] = [];
  for (const attempt of attempts) {
    if (!runIdSet.has(attempt.runId) || seen.has(attempt.id)) {
      continue;
    }
    seen.add(attempt.id);
    selected.push(attempt.id);
  }
  return selected;
}

/**
 * Merges RunAttempt usage summaries for Office attribution.
 * Preserves micro-USD integers; null estimated cost when no priced portions exist.
 */
export function mergeOfficeUsageSummaries(
  summaries: readonly RunAttemptUsageSummary[],
): OfficeUsageAggregate {
  if (summaries.length === 0) {
    return {
      modelCalls: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      pricedModelCalls: 0,
      unpricedModelCalls: 0,
      estimatedCostUsdMicros: null,
      costCoverage: "unmeasured",
      usageMeasured: false,
      attemptCount: 0,
    };
  }

  let modelCalls = 0;
  let toolCalls = 0;
  let totalTokens = 0;
  let cachedInputTokens = 0;
  let pricedModelCalls = 0;
  let unpricedModelCalls = 0;
  let pricedMicros = 0;
  let hasPricedPortion = false;

  for (const summary of summaries) {
    modelCalls += summary.modelCalls;
    toolCalls += summary.toolCalls;
    totalTokens += summary.totalTokens;
    cachedInputTokens += summary.cachedInputTokens;
    pricedModelCalls += summary.pricedModelCalls;
    unpricedModelCalls += summary.unpricedModelCalls;
    if (summary.estimatedCostUsdMicros !== null) {
      hasPricedPortion = true;
      pricedMicros += summary.estimatedCostUsdMicros;
    }
  }

  const merged = mergeRunAttemptUsageSummaries(summaries);

  let costCoverage: OfficeUsageCostCoverage;
  if (unpricedModelCalls > 0 && hasPricedPortion) {
    costCoverage = "priced_partial";
  } else if (unpricedModelCalls > 0) {
    costCoverage = "partial";
  } else if (hasPricedPortion || modelCalls > 0 || toolCalls > 0) {
    costCoverage = "complete";
  } else {
    costCoverage = "unmeasured";
  }

  const usageMeasured =
    summaries.length > 0 &&
    (modelCalls > 0 ||
      toolCalls > 0 ||
      merged.inputTokens > 0 ||
      merged.outputTokens > 0 ||
      hasPricedPortion ||
      unpricedModelCalls > 0);

  return {
    modelCalls,
    toolCalls,
    inputTokens: merged.inputTokens,
    outputTokens: merged.outputTokens,
    totalTokens,
    cachedInputTokens,
    pricedModelCalls,
    unpricedModelCalls,
    estimatedCostUsdMicros: hasPricedPortion ? pricedMicros : null,
    costCoverage,
    usageMeasured,
    attemptCount: summaries.length,
  };
}

export function rankWorkersByActiveTasks(
  assignments: readonly OfficeObservabilityAssignmentRecord[],
  limit = 8,
): readonly {
  readonly officeWorkerId: OfficeWorkerId;
  readonly active: number;
}[] {
  const counts = new Map<OfficeWorkerId, number>();
  for (const assignment of assignments) {
    if (assignment.status !== "PENDING" && assignment.status !== "RUNNING") {
      continue;
    }
    const current = counts.get(assignment.officeWorkerId) ?? 0;
    counts.set(assignment.officeWorkerId, current + 1);
  }
  return [...counts.entries()]
    .map(([officeWorkerId, active]) => ({ officeWorkerId, active }))
    .sort(
      (left, right) =>
        right.active - left.active ||
        left.officeWorkerId.localeCompare(right.officeWorkerId),
    )
    .slice(0, limit);
}

function uniqueRunIds(runIds: readonly RunId[]): readonly RunId[] {
  const seen = new Set<RunId>();
  const ordered: RunId[] = [];
  for (const runId of runIds) {
    if (seen.has(runId)) {
      continue;
    }
    seen.add(runId);
    ordered.push(runId);
  }
  return ordered;
}
