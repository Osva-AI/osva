import type {
  AssignmentId,
  GoalId,
  OfficeWorkerId,
  RunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type {
  OfficeObservabilityAssignmentRecord,
  OfficeUsageAggregate,
  TaskExecutionSummary,
} from "@osva/domain/office-observability";

import type { OfficeAssignmentResource } from "../hooks/use-office";

function parseDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}

export function toOfficeObservabilityAssignmentRecord(
  assignment: OfficeAssignmentResource,
): OfficeObservabilityAssignmentRecord {
  return {
    id: assignment.id as AssignmentId,
    workspaceId: assignment.workspaceId as WorkspaceId,
    officeWorkerId: assignment.officeWorkerId as OfficeWorkerId,
    goalId: assignment.goalId as GoalId | undefined,
    status: assignment.status,
    runId: assignment.runId as RunId | undefined,
    workflowRunId: assignment.workflowRunId as WorkflowRunId | undefined,
    startedAt: parseDate(assignment.startedAt),
    completedAt: parseDate(assignment.completedAt),
    cancelledAt: parseDate(assignment.cancelledAt),
  };
}

export function mapOfficeObservabilityAssignments(
  assignments: readonly OfficeAssignmentResource[],
): readonly OfficeObservabilityAssignmentRecord[] {
  return assignments.map((assignment) =>
    toOfficeObservabilityAssignmentRecord(assignment),
  );
}

export function formatTerminalSuccessRatePercent(
  summary: Pick<
    TaskExecutionSummary,
    "terminalSuccessRate" | "terminalDenominator"
  >,
): string {
  if (summary.terminalSuccessRate === null) {
    return "—";
  }
  return `${Math.round(summary.terminalSuccessRate * 100)}%`;
}

export function officeUsageCostLabel(usage: OfficeUsageAggregate): string {
  switch (usage.costCoverage) {
    case "unmeasured":
      return "Usage not loaded";
    case "partial":
      return "Estimated cost unavailable (unpriced model calls)";
    case "priced_partial":
      return "Partial estimated cost (excludes unpriced model calls)";
    case "complete":
      return usage.estimatedCostUsdMicros === null
        ? "No model usage recorded"
        : "Estimated cost (known priced calls)";
    default:
      return "Usage";
  }
}

export const OFFICE_OBSERVABILITY_ASSIGNMENT_SCOPE_LABEL =
  "All tasks returned by the workspace assignment list (not a paginated archive).";

export const OFFICE_TEAM_METRICS_SCOPE_LABEL =
  "Distinct tasks assigned to current team members. Overlapping team memberships are not deduplicated across teams.";

export const OFFICE_USAGE_ROLLUP_DEFERRED_LABEL =
  "Workspace usage and cost rollup requires server-side RunAttempt aggregation. Open individual task runs for attempt-level usage.";

export function formatMeasuredDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes}m ${rem}s`;
}
