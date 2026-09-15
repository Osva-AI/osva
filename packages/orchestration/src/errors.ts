import type { AgentId, RunAttemptId, RunId } from "@osva/contracts";

export class OrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class EnqueueFailedError extends OrchestrationError {
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;

  constructor(runId: RunId, runAttemptId: RunAttemptId, cause?: unknown) {
    super(
      `JobQueue.enqueue failed after persisting Run ${runId} as QUEUED and RunAttempt ${runAttemptId} as PENDING.`,
    );
    this.runId = runId;
    this.runAttemptId = runAttemptId;
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

export class IdentityMismatchError extends OrchestrationError {}

export class BindingMismatchError extends OrchestrationError {}

export class InvalidPersistedStateError extends OrchestrationError {}

export class RunAttemptNotFoundError extends OrchestrationError {
  readonly runAttemptId: RunAttemptId;

  constructor(runAttemptId: RunAttemptId) {
    super(`RunAttempt ${runAttemptId} was not found.`);
    this.runAttemptId = runAttemptId;
  }
}

export class RunNotFoundError extends OrchestrationError {
  readonly runId: RunId;

  constructor(runId: RunId) {
    super(`Run ${runId} was not found.`);
    this.runId = runId;
  }
}

export class AgentNotFoundError extends OrchestrationError {
  readonly agentId: AgentId;

  constructor(agentId: AgentId) {
    super(`Agent ${agentId} was not found.`);
    this.agentId = agentId;
  }
}

export class AgentVersionNotFoundError extends OrchestrationError {
  constructor(message: string) {
    super(message);
  }
}
