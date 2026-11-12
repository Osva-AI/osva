import type {
  AssignmentStatus,
  OfficeAssignmentResource,
} from "../hooks/use-office";
import { formatAttemptDuration } from "./formatting";

export const TASK_BOARD_COLUMNS: readonly AssignmentStatus[] = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type TaskStatusFilter = "ALL" | AssignmentStatus;

export interface OfficeTaskBoardFilters {
  readonly search: string;
  readonly missionId: string;
  readonly officeWorkerId: string;
  readonly status: TaskStatusFilter;
}

export function assignmentExecutionPath(
  assignment: OfficeAssignmentResource,
): string | undefined {
  if (assignment.runId !== undefined) {
    return `/runs/${assignment.runId}`;
  }
  if (assignment.workflowRunId !== undefined) {
    return `/workflow-runs/${assignment.workflowRunId}`;
  }
  return undefined;
}

export function assignmentDurationLabel(
  assignment: OfficeAssignmentResource,
): string {
  return formatAttemptDuration(
    assignment.startedAt,
    assignment.completedAt ?? assignment.cancelledAt,
    assignment.status === "RUNNING",
  );
}

export function filterOfficeTasks(
  assignments: readonly OfficeAssignmentResource[],
  filters: OfficeTaskBoardFilters,
): readonly OfficeAssignmentResource[] {
  const needle = filters.search.trim().toLowerCase();
  return assignments.filter((assignment) => {
    if (
      filters.missionId.length > 0 &&
      assignment.goalId !== filters.missionId
    ) {
      return false;
    }
    if (
      filters.officeWorkerId.length > 0 &&
      assignment.officeWorkerId !== filters.officeWorkerId
    ) {
      return false;
    }
    if (filters.status !== "ALL" && assignment.status !== filters.status) {
      return false;
    }
    if (needle.length === 0) {
      return true;
    }
    return assignment.title.toLowerCase().includes(needle);
  });
}

export function groupAssignmentsByStatus(
  assignments: readonly OfficeAssignmentResource[],
): Readonly<Record<AssignmentStatus, readonly OfficeAssignmentResource[]>> {
  const grouped: Record<AssignmentStatus, OfficeAssignmentResource[]> = {
    PENDING: [],
    RUNNING: [],
    COMPLETED: [],
    FAILED: [],
    CANCELLED: [],
  };
  for (const assignment of assignments) {
    grouped[assignment.status].push(assignment);
  }
  for (const status of TASK_BOARD_COLUMNS) {
    grouped[status].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
  return grouped;
}

export function assignmentsMayHaveStaleListStatus(
  assignments: readonly OfficeAssignmentResource[],
): boolean {
  return assignments.some((item) => item.status === "RUNNING");
}
