import type { JobQueue } from "@osva/contracts";
import type { RunAttemptId, RunId } from "@osva/contracts";
import {
  DomainInvariantError,
  isTerminalRunState,
  type Run,
  type RunAttempt,
  type RunRepository,
  type ScheduleOccurrence,
  type ScheduleRepository,
} from "@osva/domain";

import {
  OSVA_SPAN,
  resolveInstrumentation,
  type OsvaInstrumentation,
} from "@osva/observability";

import { CreateRun, type CreateRunCommand } from "./create-run.js";
import { EnqueueFailedError } from "./errors.js";
import { scheduleOccurrenceRunIdempotencyKey } from "./schedule-idempotency.js";

export interface DispatchScheduleOccurrenceCommand {
  readonly occurrence: ScheduleOccurrence;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly now: Date;
}

export interface DispatchScheduleOccurrenceDependencies {
  readonly schedules: ScheduleRepository;
  readonly runs: RunRepository;
  readonly createRun: CreateRun;
  readonly queue: JobQueue;
  readonly instrumentation?: OsvaInstrumentation;
  readonly logger?: {
    info(event: string, fields: Record<string, string>): void;
    error(event: string, fields: Record<string, string>): void;
  };
}

export class DispatchScheduleOccurrence {
  constructor(private readonly deps: DispatchScheduleOccurrenceDependencies) {}

  async execute(command: DispatchScheduleOccurrenceCommand): Promise<void> {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);

    await telemetry.withSpan(OSVA_SPAN.SCHEDULE_DISPATCH, undefined, async () =>
      this.executeInner(command),
    );
  }

  private async executeInner(
    command: DispatchScheduleOccurrenceCommand,
  ): Promise<void> {
    const occurrence = command.occurrence;
    const idempotencyKey = scheduleOccurrenceRunIdempotencyKey(
      occurrence.scheduleId,
      occurrence.scheduledFor,
    );

    let run =
      (occurrence.runId === null
        ? null
        : await this.deps.runs.findRunById(occurrence.runId)) ??
      (await this.deps.runs.findRunByWorkspaceIdempotencyKey(
        occurrence.workspaceId,
        idempotencyKey,
      ));

    let enqueuedByCreateRun = false;
    if (run === null) {
      const created = await this.createScheduledRun(command, idempotencyKey);
      run = created.run;
      enqueuedByCreateRun = created.enqueued;
    }

    if (occurrence.runId === null || occurrence.runId !== run.id) {
      await this.deps.schedules.attachOccurrenceRunId(occurrence.id, run.id);
    }

    const initialAttempt = await findInitialRunAttempt(this.deps.runs, run.id);
    if (initialAttempt === null) {
      throw new DomainInvariantError(
        `Scheduled Run ${run.id} is missing its initial RunAttempt.`,
      );
    }

    if (isTerminalRunState(run.status) || run.status === "RUNNING") {
      await this.markDispatchedIfNeeded(occurrence.id, command.now);
      return;
    }

    if (enqueuedByCreateRun) {
      await this.markDispatchedIfNeeded(occurrence.id, command.now);
      return;
    }

    const enqueued = await this.enqueueInitialAttempt(
      run,
      initialAttempt,
      command.now,
    );
    if (enqueued) {
      await this.markDispatchedIfNeeded(occurrence.id, command.now);
    }
  }

  private async createScheduledRun(
    command: DispatchScheduleOccurrenceCommand,
    idempotencyKey: string,
  ): Promise<{ readonly run: Run; readonly enqueued: boolean }> {
    const occurrence = command.occurrence;
    const createCommand: CreateRunCommand = {
      runId: command.runId,
      runAttemptId: command.runAttemptId,
      workspaceId: occurrence.workspaceId,
      agentId: occurrence.agentId,
      agentVersionId: occurrence.agentVersionId,
      input: occurrence.input,
      idempotencyKey,
      now: command.now,
    };

    try {
      const created = await this.deps.createRun.execute(createCommand);
      return { run: created.run, enqueued: true };
    } catch (error) {
      if (
        error instanceof DomainInvariantError &&
        error.message.includes("idempotency key")
      ) {
        const existing = await this.deps.runs.findRunByWorkspaceIdempotencyKey(
          occurrence.workspaceId,
          idempotencyKey,
        );
        if (existing !== null) {
          return { run: existing, enqueued: false };
        }
      }

      if (error instanceof EnqueueFailedError) {
        this.logError("scheduler.dispatch.enqueue_failed", {
          scheduleId: occurrence.scheduleId,
          scheduleOccurrenceId: occurrence.id,
          scheduledFor: occurrence.scheduledFor.toISOString(),
          runId: error.runId,
          runAttemptId: error.runAttemptId,
        });
        const existing = await this.deps.runs.findRunById(error.runId);
        if (existing !== null) {
          return { run: existing, enqueued: false };
        }
      }

      throw error;
    }
  }

  private async enqueueInitialAttempt(
    run: Run,
    initialAttempt: RunAttempt,
    now: Date,
  ): Promise<boolean> {
    let currentRun = run;

    if (currentRun.status === "PENDING") {
      const queued = currentRun.transitionTo("QUEUED", now);
      currentRun = await this.deps.runs.transitionRun("PENDING", queued);
    }

    if (currentRun.status !== "QUEUED") {
      return false;
    }

    try {
      await this.deps.queue.enqueue(initialAttempt.id);
      return true;
    } catch (error) {
      this.logError("scheduler.dispatch.enqueue_failed", {
        runId: currentRun.id,
        runAttemptId: initialAttempt.id,
        error: error instanceof Error ? error.name : "unknown_error",
      });
      return false;
    }
  }

  private async markDispatchedIfNeeded(
    occurrenceId: ScheduleOccurrence["id"],
    dispatchedAt: Date,
  ): Promise<void> {
    const latest = await this.deps.schedules.findOccurrenceById(occurrenceId);
    if (latest === null || latest.dispatchedAt !== null) {
      return;
    }

    await this.deps.schedules.markOccurrenceDispatched(
      occurrenceId,
      dispatchedAt,
    );
  }

  private logError(event: string, fields: Record<string, string>): void {
    this.deps.logger?.error(event, fields);
  }
}

async function findInitialRunAttempt(
  runs: RunRepository,
  runId: RunId,
): Promise<RunAttempt | null> {
  const attempts = await runs.listRunAttempts(runId);
  return attempts.find((attempt) => attempt.sequence === 1) ?? null;
}
