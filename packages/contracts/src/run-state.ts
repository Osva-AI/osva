export const RUN_STATES = [
  "PENDING",
  "QUEUED",
  "RUNNING",
  "INTERRUPTED",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
] as const;

/** Non-terminal Run awaiting checkpoint-backed recovery. */
export const RECOVERABLE_RUN_STATES = ["INTERRUPTED"] as const;

export type RecoverableRunState = (typeof RECOVERABLE_RUN_STATES)[number];

export type RunState = (typeof RUN_STATES)[number];

export const TERMINAL_RUN_STATES = [
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
] as const;

export type TerminalRunState = (typeof TERMINAL_RUN_STATES)[number];

export const RUN_ATTEMPT_STATES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
] as const;

export type RunAttemptState = (typeof RUN_ATTEMPT_STATES)[number];
