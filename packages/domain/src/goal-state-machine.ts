import { GOAL_STATES, type GoalState } from "@osva/contracts";

import { InvalidGoalTransitionError } from "./errors.js";

export const LEGAL_GOAL_TRANSITIONS: ReadonlyArray<
  readonly [GoalState, GoalState]
> = [
  ["OPEN", "ACTIVE"],
  ["OPEN", "COMPLETED"],
  ["OPEN", "CANCELLED"],
  ["ACTIVE", "COMPLETED"],
  ["ACTIVE", "CANCELLED"],
];

const LEGAL_GOAL_TRANSITION_KEYS = new Set(
  LEGAL_GOAL_TRANSITIONS.map(([from, to]) => transitionKey(from, to)),
);

export function isGoalState(value: string): value is GoalState {
  return (GOAL_STATES as readonly string[]).includes(value);
}

export function isLegalGoalTransition(from: GoalState, to: GoalState): boolean {
  return from === to || LEGAL_GOAL_TRANSITION_KEYS.has(transitionKey(from, to));
}

export function assertLegalGoalTransition(
  from: GoalState,
  to: GoalState,
): void {
  if (!isLegalGoalTransition(from, to)) {
    throw new InvalidGoalTransitionError(from, to);
  }
}

function transitionKey(from: GoalState, to: GoalState): string {
  return `${from}->${to}`;
}
