export type MissionProgressAssignmentStatus =
  "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface MissionProgressAssignment {
  readonly goalId?: string;
  readonly status: MissionProgressAssignmentStatus;
}

export interface MissionProgressSnapshot {
  readonly total: number;
  readonly pending: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  /** Ratio of completed assignments to total (0 when total is 0). */
  readonly completedRatio: number;
}

/**
 * Derives presentation-only mission progress from assignments linked to a goal.
 * Does not read or mutate Goal.status — mission lifecycle stays manual.
 */
export function computeMissionProgress(
  goalId: string,
  assignments: readonly MissionProgressAssignment[],
): MissionProgressSnapshot {
  const linked = assignments.filter((item) => item.goalId === goalId);
  let pending = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  for (const item of linked) {
    switch (item.status) {
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
  const total = linked.length;
  return {
    total,
    pending,
    running,
    completed,
    failed,
    cancelled,
    completedRatio: total === 0 ? 0 : completed / total,
  };
}

/** Assignments with no goalId are unassigned tasks (not counted in mission progress). */
export function unassignedTasks<T extends MissionProgressAssignment>(
  assignments: readonly T[],
): readonly T[] {
  return assignments.filter((item) => item.goalId === undefined);
}
