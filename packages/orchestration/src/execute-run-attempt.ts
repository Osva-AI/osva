import type {
  ExecutionError,
  ExecutionFailure,
  ExecutionResult,
  ExecutionSuccess,
  RuntimeAdapter,
} from "@osva-ai/contracts";
import type { RunAttemptId, RunState } from "@osva-ai/contracts";
import {
  DEFAULT_EXECUTION_HEARTBEAT_INTERVAL_MS,
  DEFAULT_EXECUTION_LEASE_TTL_MS,
} from "@osva-ai/contracts";
import {
  isTerminalRunAttemptState,
  DomainInvariantError,
  LifecycleConflictError,
  type AgentRepository,
  type Run,
  type RunAttempt,
  type RunAttemptError,
  type RunRepository,
  type TerminalRunAttemptState,
} from "@osva/domain";
import {
  OSVA_ATTR,
  OSVA_METRIC,
  OSVA_SPAN,
  elapsedMs,
  resolveInstrumentation,
  type ActiveSpan,
  type OsvaInstrumentation,
} from "@osva/observability";
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
const DEFAULT_EXECUTION_OWNER = "execution-worker";
const INITIAL_EXECUTION_GENERATION = 1;

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

export interface ExecuteRunAttemptHeartbeat {
  start(tick: () => Promise<void>, intervalMs: number): () => void;
}

export interface ExecuteRunAttemptDependencies {
  readonly runs: RunRepository;
  readonly agents: AgentRepository;
  readonly runtime: RuntimeAdapter;
  readonly instrumentation?: OsvaInstrumentation;
  readonly executionOwner?: string;
  readonly leaseTtlMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeat?: ExecuteRunAttemptHeartbeat;
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

export interface ExecuteRunAttemptOwnershipLost {
  readonly outcome: "ownership-lost";
  readonly run: Run;
  readonly runAttempt: RunAttempt;
}

export type ExecuteRunAttemptResult =
  | ExecuteRunAttemptSucceeded
  | ExecuteRunAttemptFailed
  | ExecuteRunAttemptAlreadyTerminal
  | ExecuteRunAttemptAlreadyInProgress
  | ExecuteRunAttemptOwnershipLost;

/**
 * Reconstructs ExecutionRequest from persisted OSVA state and drives one
 * RunAttempt through the runtime boundary.
 *
 * PENDING → RUNNING acquires an execution lease. Only the winning owner may
 * heartbeat or persist a terminal outcome. Queue redelivery of a RUNNING
 * attempt is a no-op and never invokes runtime.execute().
 */
export class ExecuteRunAttempt {
  private readonly executionOwner: string;
  private readonly leaseTtlMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeat: ExecuteRunAttemptHeartbeat;

  constructor(private readonly deps: ExecuteRunAttemptDependencies) {
    this.executionOwner =
      deps.executionOwner?.trim() || DEFAULT_EXECUTION_OWNER;
    this.leaseTtlMs = deps.leaseTtlMs ?? DEFAULT_EXECUTION_LEASE_TTL_MS;
    this.heartbeatIntervalMs =
      deps.heartbeatIntervalMs ?? DEFAULT_EXECUTION_HEARTBEAT_INTERVAL_MS;
    this.heartbeat = deps.heartbeat ?? intervalHeartbeat();
  }

  async execute(
    command: ExecuteRunAttemptCommand,
  ): Promise<ExecuteRunAttemptResult> {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);
    const startedAt = performance.now();

    return telemetry.withSpan(
      OSVA_SPAN.RUN_ATTEMPT_EXECUTE,
      {
        [OSVA_ATTR.RUN_ATTEMPT_ID]: command.runAttemptId,
      },
      async (span) => {
        const result = await this.executeInner(command, span);
        if (result.outcome === "succeeded" || result.outcome === "failed") {
          telemetry.recordHistogram(
            OSVA_METRIC.RUN_DURATION_MS,
            elapsedMs(startedAt, performance.now()),
            {
              terminal_status: result.run.status,
            },
          );
          if (result.outcome === "succeeded") {
            telemetry.recordCounter(OSVA_METRIC.RUNS_COMPLETED, 1, {
              terminal_status: result.run.status,
            });
          } else {
            telemetry.recordCounter(OSVA_METRIC.RUNS_FAILED, 1, {
              terminal_status: result.run.status,
            });
          }
        }
        return result;
      },
    );
  }

  private async executeInner(
    command: ExecuteRunAttemptCommand,
    span: ActiveSpan,
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

    span.setAttributes({
      [OSVA_ATTR.RUN_ID]: run.id,
      [OSVA_ATTR.AGENT_VERSION_ID]: run.effectiveBindings.agentVersionId,
    });

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

    const acquired = await this.acquireRunningLease(run, attempt, command.now);
    if (acquired.outcome !== "acquired") {
      return acquired.result;
    }

    const runningRun = acquired.run;
    const runningAttempt = acquired.runAttempt;
    const request = createExecutionRequest({
      run: runningRun,
      runAttempt: runningAttempt,
      agentVersion,
    });

    let ownershipLost = false;
    const stopHeartbeat = this.startLeaseHeartbeat(runningAttempt, () => {
      ownershipLost = true;
    });

    let result: ExecutionResult;
    try {
      result = await this.deps.runtime.execute(request);
    } catch (error) {
      stopHeartbeat();
      if (ownershipLost) {
        await this.signalRuntimeCancellation(runningAttempt.id);
        return this.loadOwnershipLost(runningRun.id, runningAttempt.id);
      }
      return this.persistFailure(
        runningRun,
        runningAttempt,
        command.now,
        snapshotThrownError(error),
      );
    }

    stopHeartbeat();

    if (ownershipLost) {
      await this.signalRuntimeCancellation(runningAttempt.id);
      return this.loadOwnershipLost(runningRun.id, runningAttempt.id);
    }

    if (result.status === "succeeded") {
      let succeededAttempt: RunAttempt;
      try {
        succeededAttempt = runningAttempt.transitionTo(
          "SUCCEEDED",
          command.now,
          { output: result.output },
        );
      } catch (error) {
        if (error instanceof DomainInvariantError) {
          return this.persistFailure(
            runningRun,
            runningAttempt,
            command.now,
            Object.freeze({
              code: "INVALID_RUNTIME_OUTPUT",
              message: "Runtime output must be JSON-compatible.",
            }),
          );
        }

        throw error;
      }

      const succeededRun = runningRun.transitionTo("SUCCEEDED", command.now);
      return this.persistTerminal(
        runningRun,
        runningAttempt,
        succeededRun,
        succeededAttempt,
        {
          outcome: "succeeded",
          result,
          run: succeededRun,
          runAttempt: succeededAttempt,
        },
      );
    }

    return this.persistFailure(
      runningRun,
      runningAttempt,
      command.now,
      snapshotExecutionError(result.error),
    );
  }

  private async acquireRunningLease(
    run: Run,
    attempt: RunAttempt,
    now: Date,
  ): Promise<
    | {
        readonly outcome: "acquired";
        readonly run: Run;
        readonly runAttempt: RunAttempt;
      }
    | {
        readonly outcome: "conflict";
        readonly result: ExecuteRunAttemptResult;
      }
  > {
    const runningAttempt = attempt
      .transitionTo("RUNNING", now)
      .withExecutionLease({
        owner: this.executionOwner,
        generation: INITIAL_EXECUTION_GENERATION,
        expiresAt: new Date(now.getTime() + this.leaseTtlMs),
      });
    const runningRun = run.transitionTo("RUNNING", now);

    try {
      const persisted = await this.deps.runs.transitionRunAndAttempt(
        run.status,
        runningRun,
        attempt.status,
        runningAttempt,
        { leaseTtlMs: this.leaseTtlMs },
      );
      return {
        outcome: "acquired",
        run: persisted.run,
        runAttempt: persisted.runAttempt,
      };
    } catch (error) {
      if (!(error instanceof LifecycleConflictError)) {
        throw error;
      }

      const latestAttempt = await this.deps.runs.findRunAttemptById(attempt.id);
      const latestRun =
        latestAttempt === null
          ? null
          : await this.deps.runs.findRunById(latestAttempt.runId);
      if (latestAttempt === null || latestRun === null) {
        throw error;
      }

      if (isTerminalRunAttemptState(latestAttempt.status)) {
        return {
          outcome: "conflict",
          result: {
            outcome: "already-terminal",
            run: latestRun,
            runAttempt: latestAttempt,
          },
        };
      }

      if (latestAttempt.status === "RUNNING") {
        return {
          outcome: "conflict",
          result: {
            outcome: "already-in-progress",
            run: latestRun,
            runAttempt: latestAttempt,
          },
        };
      }

      throw error;
    }
  }

  private startLeaseHeartbeat(
    attempt: RunAttempt,
    onLost: () => void,
  ): () => void {
    if (this.heartbeatIntervalMs <= 0 || attempt.executionOwner === undefined) {
      return () => undefined;
    }

    const owner = attempt.executionOwner;
    const generation = attempt.executionGeneration;
    let stopped = false;

    const stop = this.heartbeat.start(async () => {
      if (stopped) {
        return;
      }

      const renewed = await this.deps.runs.renewExecutionLease({
        runAttemptId: attempt.id,
        owner,
        generation,
        ttlMs: this.leaseTtlMs,
      });
      if (!renewed && !stopped) {
        stopped = true;
        onLost();
        await this.signalRuntimeCancellation(attempt.id);
      }
    }, this.heartbeatIntervalMs);

    return () => {
      stopped = true;
      stop();
    };
  }

  private async persistFailure(
    runningRun: Run,
    runningAttempt: RunAttempt,
    now: Date,
    error: RunAttemptError,
  ): Promise<ExecuteRunAttemptFailed | ExecuteRunAttemptOwnershipLost> {
    const failedAttempt = runningAttempt.transitionTo("FAILED", now, { error });
    const failedRun = runningRun.transitionTo("FAILED", now);
    const persisted = await this.persistTerminal(
      runningRun,
      runningAttempt,
      failedRun,
      failedAttempt,
      {
        outcome: "failed",
        result: {
          status: "failed",
          error,
        },
        run: failedRun,
        runAttempt: failedAttempt,
      },
    );

    if (persisted.outcome === "failed") {
      return persisted;
    }

    if (persisted.outcome === "ownership-lost") {
      return persisted;
    }

    return this.loadOwnershipLost(runningRun.id, runningAttempt.id);
  }

  private async persistTerminal<
    T extends ExecuteRunAttemptSucceeded | ExecuteRunAttemptFailed,
  >(
    expectedRun: Run,
    expectedAttempt: RunAttempt,
    nextRun: Run,
    nextAttempt: RunAttempt,
    success: T,
  ): Promise<T | ExecuteRunAttemptOwnershipLost> {
    try {
      const persisted = await this.deps.runs.transitionRunAndAttempt(
        expectedRun.status,
        nextRun,
        expectedAttempt.status,
        nextAttempt,
      );
      return {
        ...success,
        run: persisted.run,
        runAttempt: persisted.runAttempt,
      };
    } catch (error) {
      if (error instanceof LifecycleConflictError) {
        return this.loadOwnershipLost(expectedRun.id, expectedAttempt.id);
      }

      throw error;
    }
  }

  private async loadOwnershipLost(
    runId: Run["id"],
    runAttemptId: RunAttemptId,
  ): Promise<ExecuteRunAttemptOwnershipLost> {
    const runAttempt = await this.deps.runs.findRunAttemptById(runAttemptId);
    const run =
      runAttempt === null ? null : await this.deps.runs.findRunById(runId);
    if (runAttempt === null || run === null) {
      throw new RunAttemptNotFoundError(runAttemptId);
    }

    return {
      outcome: "ownership-lost",
      run,
      runAttempt,
    };
  }

  private async signalRuntimeCancellation(
    runAttemptId: RunAttemptId,
  ): Promise<void> {
    const runtime = this.deps.runtime;
    if (!isCancellableRuntime(runtime)) {
      return;
    }

    try {
      await runtime.cancel(runAttemptId);
    } catch {
      // Cancellation is best-effort and cannot undo prior external side effects.
    }
  }
}

function intervalHeartbeat(): ExecuteRunAttemptHeartbeat {
  return {
    start(tick, intervalMs) {
      const timer = setInterval(() => {
        void tick();
      }, intervalMs);
      timer.unref?.();
      return () => {
        clearInterval(timer);
      };
    },
  };
}

function isCancellableRuntime(
  runtime: RuntimeAdapter,
): runtime is RuntimeAdapter & {
  cancel(runAttemptId: RunAttemptId): Promise<void>;
} {
  return (
    "cancel" in runtime &&
    typeof (runtime as { cancel?: unknown }).cancel === "function"
  );
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
