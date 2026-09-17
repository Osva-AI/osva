import { ASSIGNMENT_STATES, type AssignmentState } from "@osva/contracts";

import { InvalidAssignmentTransitionError } from "./errors.js";

export const LEGAL_ASSIGNMENT_TRANSITIONS: ReadonlyArray<
  readonly [AssignmentState, AssignmentState]
> = [
  ["PENDING", "RUNNING"],
  ["PENDING", "CANCELLED"],
  ["RUNNING", "COMPLETED"],
  ["RUNNING", "FAILED"],
  ["RUNNING", "CANCELLED"],
];

export const TERMINAL_ASSIGNMENT_STATES = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type TerminalAssignmentState =
  (typeof TERMINAL_ASSIGNMENT_STATES)[number];

const LEGAL_ASSIGNMENT_TRANSITION_KEYS = new Set(
  LEGAL_ASSIGNMENT_TRANSITIONS.map(([from, to]) => transitionKey(from, to)),
);

export function isAssignmentState(value: string): value is AssignmentState {
  return (ASSIGNMENT_STATES as readonly string[]).includes(value);
}

export function isTerminalAssignmentState(
  status: AssignmentState,
): status is TerminalAssignmentState {
  return (TERMINAL_ASSIGNMENT_STATES as readonly string[]).includes(status);
}

export function isLegalAssignmentTransition(
  from: AssignmentState,
  to: AssignmentState,
): boolean {
  return (
    from === to || LEGAL_ASSIGNMENT_TRANSITION_KEYS.has(transitionKey(from, to))
  );
}

export function assertLegalAssignmentTransition(
  from: AssignmentState,
  to: AssignmentState,
): void {
  if (!isLegalAssignmentTransition(from, to)) {
    throw new InvalidAssignmentTransitionError(from, to);
  }
}

function transitionKey(from: AssignmentState, to: AssignmentState): string {
  return `${from}->${to}`;
}
