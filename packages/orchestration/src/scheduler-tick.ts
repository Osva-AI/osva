import type {
  RunAttemptId,
  RunId,
  ScheduleOccurrenceId,
} from "@osva/contracts";
import type { ScheduleOccurrence, ScheduleRepository } from "@osva/domain";

import {
  OSVA_SPAN,
  resolveInstrumentation,
  type OsvaInstrumentation,
} from "@osva/observability";

import {
  DispatchScheduleOccurrence,
  type DispatchScheduleOccurrenceCommand,
} from "./dispatch-schedule-occurrence.js";

export interface SchedulerTickIds {
  createRunId(): RunId;
  createRunAttemptId(): RunAttemptId;
  createScheduleOccurrenceId(): ScheduleOccurrenceId;
}

export interface SchedulerTickDependencies {
  readonly schedules: ScheduleRepository;
  readonly dispatch: DispatchScheduleOccurrence;
  readonly materializeBatchSize?: number;
  readonly dispatchBatchSize?: number;
  readonly instrumentation?: OsvaInstrumentation;
  readonly logger?: {
    info(event: string, fields: Record<string, string>): void;
    error(event: string, fields: Record<string, string>): void;
  };
}

export class SchedulerTick {
  private readonly materializeBatchSize: number;
  private readonly dispatchBatchSize: number;

  constructor(private readonly deps: SchedulerTickDependencies) {
    this.materializeBatchSize = deps.materializeBatchSize ?? 100;
    this.dispatchBatchSize = deps.dispatchBatchSize ?? 100;
  }

  async execute(now: Date, ids: SchedulerTickIds): Promise<void> {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);

    const materialized = await telemetry.withSpan(
      OSVA_SPAN.SCHEDULE_MATERIALIZE,
      undefined,
      async () =>
        this.deps.schedules.materializeDueOccurrences(
          now,
          this.materializeBatchSize,
          () => ids.createScheduleOccurrenceId(),
        ),
    );

    const undispatched = await this.deps.schedules.listUndispatchedOccurrences(
      this.dispatchBatchSize,
    );

    const targets = dedupeOccurrences([...materialized, ...undispatched]);
    for (const occurrence of targets) {
      await this.dispatchOccurrence(occurrence, now, ids);
    }
  }

  private async dispatchOccurrence(
    occurrence: ScheduleOccurrence,
    now: Date,
    ids: SchedulerTickIds,
  ): Promise<void> {
    const latest =
      (await this.deps.schedules.findOccurrenceById(occurrence.id)) ??
      occurrence;

    const command: DispatchScheduleOccurrenceCommand = {
      occurrence: latest,
      runId: ids.createRunId(),
      runAttemptId: ids.createRunAttemptId(),
      now,
    };

    try {
      await this.deps.dispatch.execute(command);
      this.deps.logger?.info("scheduler.dispatch.succeeded", {
        scheduleId: latest.scheduleId,
        scheduleOccurrenceId: latest.id,
        scheduledFor: latest.scheduledFor.toISOString(),
        runId: latest.runId ?? command.runId,
        runAttemptId: command.runAttemptId,
      });
    } catch (error) {
      this.deps.logger?.error("scheduler.dispatch.failed", {
        scheduleId: latest.scheduleId,
        scheduleOccurrenceId: latest.id,
        scheduledFor: latest.scheduledFor.toISOString(),
        error: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }
}

function dedupeOccurrences(
  occurrences: readonly ScheduleOccurrence[],
): ScheduleOccurrence[] {
  const seen = new Set<string>();
  const result: ScheduleOccurrence[] = [];

  for (const occurrence of occurrences) {
    if (seen.has(occurrence.id)) {
      continue;
    }

    seen.add(occurrence.id);
    result.push(occurrence);
  }

  return result;
}
