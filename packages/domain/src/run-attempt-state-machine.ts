import { RUN_ATTEMPT_STATES, type RunAttemptState } from "@osva/contracts";

import { InvalidRunAttemptTransitionError } from "./errors.js";

export const TERMINAL_RUN_ATTEMPT_STATES = [
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
] as const;

export type TerminalRunAttemptState =
  (typeof TERMINAL_RUN_ATTEMPT_STATES)[number];

export const RETRYABLE_RUN_ATTEMPT_STATES = [
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
] as const;

export type RetryableRunAttemptState =
  (typeof RETRYABLE_RUN_ATTEMPT_STATES)[number];

export const LEGAL_RUN_ATTEMPT_TRANSITIONS: ReadonlyArray<
  readonly [RunAttemptState, RunAttemptState]
> = [
  ["PENDING", "RUNNING"],
  ["RUNNING", "SUCCEEDED"],
  ["RUNNING", "FAILED"],
  ["RUNNING", "TIMED_OUT"],
  ["RUNNING", "CANCELLED"],
  ["PENDING", "CANCELLED"],
];

const LEGAL_RUN_ATTEMPT_TRANSITION_KEYS = new Set(
  LEGAL_RUN_ATTEMPT_TRANSITIONS.map(([from, to]) =>
    attemptTransitionKey(from, to),
  ),
);

const TERMINAL_RUN_ATTEMPT_STATE_SET = new Set<RunAttemptState>(
  TERMINAL_RUN_ATTEMPT_STATES,
);

const RETRYABLE_RUN_ATTEMPT_STATE_SET = new Set<RunAttemptState>(
  RETRYABLE_RUN_ATTEMPT_STATES,
);

export function isRunAttemptState(value: string): value is RunAttemptState {
  return (RUN_ATTEMPT_STATES as readonly string[]).includes(value);
}

export function isTerminalRunAttemptState(
  state: RunAttemptState,
): state is TerminalRunAttemptState {
  return TERMINAL_RUN_ATTEMPT_STATE_SET.has(state);
}

export function isRetryableRunAttemptState(
  state: RunAttemptState,
): state is RetryableRunAttemptState {
  return RETRYABLE_RUN_ATTEMPT_STATE_SET.has(state);
}

export function isLegalRunAttemptTransition(
  from: RunAttemptState,
  to: RunAttemptState,
): boolean {
  return LEGAL_RUN_ATTEMPT_TRANSITION_KEYS.has(attemptTransitionKey(from, to));
}

export function assertLegalRunAttemptTransition(
  from: RunAttemptState,
  to: RunAttemptState,
): void {
  if (!isLegalRunAttemptTransition(from, to)) {
    throw new InvalidRunAttemptTransitionError(from, to);
  }
}

function attemptTransitionKey(
  from: RunAttemptState,
  to: RunAttemptState,
): string {
  return `${from}->${to}`;
}
