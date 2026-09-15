import type { RunAttemptState, RunState } from "@osva/contracts";

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DomainInvariantError extends DomainError {}

export class InvalidRunTransitionError extends DomainError {
  readonly from: RunState;
  readonly to: RunState;

  constructor(from: RunState, to: RunState) {
    super(`Invalid run transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }
}

export class InvalidRunAttemptTransitionError extends DomainError {
  readonly from: RunAttemptState;
  readonly to: RunAttemptState;

  constructor(from: RunAttemptState, to: RunAttemptState) {
    super(`Invalid run attempt transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }
}

export class InvalidAttemptSequenceError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

export class InvalidSubsequentAttemptError extends DomainInvariantError {
  readonly previousStatus: RunAttemptState;

  constructor(previousStatus: RunAttemptState) {
    super(
      previousStatus === "SUCCEEDED"
        ? "A successful RunAttempt cannot be followed by another attempt."
        : `A subsequent RunAttempt requires the previous attempt to be FAILED, TIMED_OUT, or CANCELLED. Previous status was ${previousStatus}.`,
    );
    this.previousStatus = previousStatus;
  }
}
