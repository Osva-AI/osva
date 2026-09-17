export const GOAL_STATES = [
  "OPEN",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
] as const;

export type GoalState = (typeof GOAL_STATES)[number];

export const ASSIGNMENT_STATES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];

export const ASSIGNMENT_TARGET_TYPES = [
  "AGENT_VERSION",
  "WORKFLOW_VERSION",
] as const;

export type AssignmentTargetType = (typeof ASSIGNMENT_TARGET_TYPES)[number];
