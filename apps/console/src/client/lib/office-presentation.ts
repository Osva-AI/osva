import type { StatusVisualCategory } from "./statuses";

import type { AssignmentStatus, GoalStatus } from "../hooks/use-office";

/** Mirrors `packages/domain/src/goal-state-machine.ts` for client-side status pickers. */
const LEGAL_GOAL_TRANSITIONS: ReadonlyArray<readonly [GoalStatus, GoalStatus]> =
  [
    ["OPEN", "ACTIVE"],
    ["OPEN", "COMPLETED"],
    ["OPEN", "CANCELLED"],
    ["ACTIVE", "COMPLETED"],
    ["ACTIVE", "CANCELLED"],
  ];

const LEGAL_GOAL_TRANSITION_KEYS = new Set(
  LEGAL_GOAL_TRANSITIONS.map(([from, to]) => `${from}->${to}`),
);

export function isLegalGoalTransition(
  from: GoalStatus,
  to: GoalStatus,
): boolean {
  return from === to || LEGAL_GOAL_TRANSITION_KEYS.has(`${from}->${to}`);
}

/** Goal statuses the user may select when editing a mission (includes current). */
export function selectableGoalStatuses(
  current: GoalStatus,
): readonly GoalStatus[] {
  const options = new Set<GoalStatus>([current]);
  for (const status of ["OPEN", "ACTIVE", "COMPLETED", "CANCELLED"] as const) {
    if (isLegalGoalTransition(current, status)) {
      options.add(status);
    }
  }
  return [...options];
}

export function goalStatusCategory(status: GoalStatus): StatusVisualCategory {
  switch (status) {
    case "OPEN":
      return "inactive";
    case "ACTIVE":
      return "active";
    case "COMPLETED":
      return "success";
    case "CANCELLED":
      return "neutral";
    default:
      return "neutral";
  }
}

export function assignmentStatusCategory(
  status: AssignmentStatus,
): StatusVisualCategory {
  switch (status) {
    case "PENDING":
      return "inactive";
    case "RUNNING":
      return "active";
    case "COMPLETED":
      return "success";
    case "FAILED":
      return "error";
    case "CANCELLED":
      return "neutral";
    default:
      return "neutral";
  }
}

export function slugOfficeKeyFromName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 48) : "item";
}
