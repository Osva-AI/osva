import type {
  ExecutionError,
  ExecutionFailure,
  ExecutionResult,
  ExecutionSuccess,
  RuntimeAdapter,
} from "@osva/contracts";
import type { RunAttemptId, RunState } from "@osva/contracts";
import {
  isTerminalRunAttemptState,
  type AgentRepository,
  type Run,
  type RunAttempt,
  type RunAttemptError,
  type RunRepository,
  type TerminalRunAttemptState,
} from "@osva/domain";
import { createExecutionRequest } from "@osva/runtime-core";

import {
  AgentVersionNotFoundError,
  BindingMismatchError,
  IdentityMismatchError,
  InvalidPersistedStateError,
  RunAttemptNotFoundError,
  RunNotFoundError,
} from "./errors.js";

const RUNTIME_ADAPTER_ERROR_CODE = "RUNTIME_ADAPTER_ERROR";
const MAX_ERROR_MESSAGE_LENGTH = 500;
const MAX_ERROR_CODE_LENGTH = 128;

const TERMINAL_ATTEMPT_TO_RUN: Record<TerminalRunAttemptState, RunState> = {
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  TIMED_OUT: "TIMED_OUT",
  CANCELLED: "CANCELLED",
};

export interface ExecuteRunAttemptCommand {
  readonly runAttemptId: RunAttemptId;
  readonly now: Date;
}

export interface ExecuteRunAttemptDependencies {
  readonly runs: RunRepository;
  readonly agents: AgentRepository;
  readonly runtime: RuntimeAdapter;
}

export interface ExecuteRunAttemptSucceeded {
  readonly outcome: "succeeded";
  readonly result: ExecutionSuccess;
  readonly run: Run;
  readonly runAttempt: RunAttempt;
}

export interface ExecuteRunAttemptFailed {
  readonly outcome: "failed";
  readonly result: ExecutionFailure;
  readonly run: Run;
  readonly runAttempt: RunAttempt;
}

export interface ExecuteRunAttemptAlreadyTerminal {
  readonly outcome: "already-terminal";
  readonly run: Run;
  readonly runAttempt: RunAttempt;
}

export interface ExecuteRunAttemptAlreadyInProgress {
  readonly outcome: "already-in-progress";
  readonly run: Run;
  readonly runAttempt: RunAttempt;
}

export type ExecuteRunAttemptResult =
  | ExecuteRunAttemptSucceeded
  | ExecuteRunAttemptFailed
  | ExecuteRunAttemptAlreadyTerminal
  | ExecuteRunAttemptAlreadyInProgress;

/**
 * Reconstructs ExecutionRequest from persisted OSVA state and drives one
 * RunAttempt through the runtime boundary.
 *
 * RuntimeAdapter throws are converted into FAILED Run/RunAttempt snapshots
 * with a normalized `{ code, message }` error, then returned as
 * `{ outcome: "failed" }`. The service does not rethrow after that persist,
 * so Stage 0 does not leave attempts marked RUNNING after an adapter crash.
 */
export class ExecuteRunAttempt {
  constructor(private readonly deps: ExecuteRunAttemptDependencies) {}

  async execute(
    command: ExecuteRunAttemptCommand,
  ): Promise<ExecuteRunAttemptResult> {
    const attempt = await this.deps.runs.findRunAttemptById(
      command.runAttemptId,
    );
    if (attempt === null) {
      throw new RunAttemptNotFoundError(command.runAttemptId);
    }

    const run = await this.deps.runs.findRunById(attempt.runId);
    if (run === null) {
      throw new RunNotFoundError(attempt.runId);
    }

    if (attempt.runId !== run.id) {
      throw new IdentityMismatchError(
        `RunAttempt ${attempt.id} references Run ${attempt.runId}, but loaded Run is ${run.id}.`,
      );
    }

    if (isTerminalRunAttemptState(attempt.status)) {
      const expectedRunStatus = TERMINAL_ATTEMPT_TO_RUN[attempt.status];
      if (run.status !== expectedRunStatus) {
        throw new InvalidPersistedStateError(
          `RunAttempt ${attempt.id} is ${attempt.status} while Run ${run.id} is ${run.status}, expected ${expectedRunStatus}.`,
        );
      }

      return {
        outcome: "already-terminal",
        run,
        runAttempt: attempt,
      };
    }

    if (attempt.status === "RUNNING") {
      if (run.status !== "RUNNING") {
        throw new InvalidPersistedStateError(
          `RunAttempt ${attempt.id} is RUNNING while Run ${run.id} is ${run.status}.`,
        );
      }

      return {
        outcome: "already-in-progress",
        run,
        runAttempt: attempt,
      };
    }

    if (attempt.status !== "PENDING") {
      throw new InvalidPersistedStateError(
        `RunAttempt ${attempt.id} is ${attempt.status} and cannot be executed.`,
      );
    }

    if (run.status !== "QUEUED") {
      throw new InvalidPersistedStateError(
        `RunAttempt ${attempt.id} is PENDING while Run ${run.id} is ${run.status}, expected QUEUED.`,
      );
    }

    const agentVersionId = run.effectiveBindings.agentVersionId;
    const agentVersion =
      await this.deps.agents.findAgentVersionById(agentVersionId);
    if (agentVersion === null) {
      throw new AgentVersionNotFoundError(
        `AgentVersion ${agentVersionId} was not found for Run ${run.id}.`,
      );
    }

    if (agentVersion.id !== agentVersionId) {
      throw new BindingMismatchError(
        `Run ${run.id} is bound to AgentVersion ${agentVersionId}, but loaded AgentVersion is ${agentVersion.id}.`,
      );
    }

    if (agentVersion.agentId !== run.agentId) {
      throw new BindingMismatchError(
        `Run ${run.id} belongs to Agent ${run.agentId}, but bound AgentVersion ${agentVersion.id} belongs to Agent ${agentVersion.agentId}.`,
      );
    }

    const runningAttempt = attempt.transitionTo("RUNNING", command.now);
    const runningRun = run.transitionTo("RUNNING", command.now);
    await this.deps.runs.saveRunAttempt(runningAttempt);
    await this.deps.runs.saveRun(runningRun);

    const request = createExecutionRequest({
      run: runningRun,
      runAttempt: runningAttempt,
      agentVersion,
    });

    let result: ExecutionResult;
    try {
      result = await this.deps.runtime.execute(request);
    } catch (error) {
      return this.persistFailure(
        runningRun,
        runningAttempt,
        command.now,
        snapshotThrownError(error),
      );
    }

    if (result.status === "succeeded") {
      const succeededAttempt = runningAttempt.transitionTo(
        "SUCCEEDED",
        command.now,
      );
      const succeededRun = runningRun.transitionTo("SUCCEEDED", command.now);
      await this.deps.runs.saveRunAttempt(succeededAttempt);
      await this.deps.runs.saveRun(succeededRun);
      return {
        outcome: "succeeded",
        result,
        run: succeededRun,
        runAttempt: succeededAttempt,
      };
    }

    return this.persistFailure(
      runningRun,
      runningAttempt,
      command.now,
      snapshotExecutionError(result.error),
    );
  }

  private async persistFailure(
    runningRun: Run,
    runningAttempt: RunAttempt,
    now: Date,
    error: RunAttemptError,
  ): Promise<ExecuteRunAttemptFailed> {
    const failedAttempt = runningAttempt.transitionTo("FAILED", now, { error });
    const failedRun = runningRun.transitionTo("FAILED", now);
    await this.deps.runs.saveRunAttempt(failedAttempt);
    await this.deps.runs.saveRun(failedRun);

    const result: ExecutionFailure = {
      status: "failed",
      error,
    };

    return {
      outcome: "failed",
      result,
      run: failedRun,
      runAttempt: failedAttempt,
    };
  }
}

function snapshotExecutionError(error: ExecutionError): RunAttemptError {
  return Object.freeze({
    code: sanitizeErrorCode(error.code, "EXECUTION_FAILED"),
    message: sanitizeErrorMessage(error.message, "Execution failed."),
  });
}

function snapshotThrownError(error: unknown): RunAttemptError {
  const message =
    error instanceof Error
      ? sanitizeErrorMessage(error.message, "Runtime adapter failed.")
      : "Runtime adapter failed.";

  return Object.freeze({
    code: RUNTIME_ADAPTER_ERROR_CODE,
    message,
  });
}

function sanitizeErrorCode(value: string, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }

  return trimmed.slice(0, MAX_ERROR_CODE_LENGTH);
}

function sanitizeErrorMessage(value: string, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }

  return trimmed.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}
