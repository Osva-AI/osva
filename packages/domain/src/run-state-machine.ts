import {
  RUN_STATES,
  TERMINAL_RUN_STATES,
  type RunState,
  type TerminalRunState,
} from "@osva/contracts";

import { InvalidRunTransitionError } from "./errors.js";

export const LEGAL_RUN_TRANSITIONS: ReadonlyArray<
  readonly [RunState, RunState]
> = [
  ["PENDING", "QUEUED"],
  ["QUEUED", "RUNNING"],
  ["RUNNING", "SUCCEEDED"],
  ["PENDING", "FAILED"],
  ["QUEUED", "CANCELLED"],
  ["RUNNING", "FAILED"],
  ["RUNNING", "TIMED_OUT"],
  ["RUNNING", "CANCELLED"],
];

const LEGAL_RUN_TRANSITION_KEYS = new Set(
  LEGAL_RUN_TRANSITIONS.map(([from, to]) => transitionKey(from, to)),
);

const TERMINAL_RUN_STATE_SET = new Set<RunState>(TERMINAL_RUN_STATES);

export function isRunState(value: string): value is RunState {
  return (RUN_STATES as readonly string[]).includes(value);
}

export function isTerminalRunState(state: RunState): state is TerminalRunState {
  return TERMINAL_RUN_STATE_SET.has(state);
}

export function isLegalRunTransition(from: RunState, to: RunState): boolean {
  return LEGAL_RUN_TRANSITION_KEYS.has(transitionKey(from, to));
}

export function assertLegalRunTransition(from: RunState, to: RunState): void {
  if (!isLegalRunTransition(from, to)) {
    throw new InvalidRunTransitionError(from, to);
  }
}

function transitionKey(from: RunState, to: RunState): string {
  return `${from}->${to}`;
}
