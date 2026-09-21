import type {
  RunId,
  ScheduleId,
  ScheduleOccurrenceId,
  WorkspaceId,
} from "@osva/contracts";
import {
  DomainInvariantError,
  DuplicateScheduleKeyError,
  Schedule,
  ScheduleOccurrence,
  ScheduleNotFoundError,
  nextCronInstantAfter,
  type ListScheduleOccurrencesQuery,
  type ListScheduleOccurrencesResult,
  type ListSchedulesQuery,
  type ListSchedulesResult,
  type ScheduleOccurrenceListCursor,
  type ScheduleRepository,
} from "@osva/domain";

export class MemoryScheduleRepository implements ScheduleRepository {
  private readonly schedules = new Map<ScheduleId, Schedule>();
  private readonly occurrences = new Map<
    ScheduleOccurrenceId,
    ScheduleOccurrence
  >();
  private readonly scheduleKeys = new Map<string, ScheduleId>();
  private readonly occurrenceUniqueKeys = new Set<string>();

  async saveSchedule(schedule: Schedule): Promise<void> {
    const key = workspaceScheduleKey(schedule.workspaceId, schedule.key);
    if (this.scheduleKeys.has(key)) {
      throw new DuplicateScheduleKeyError(schedule.workspaceId, schedule.key);
    }

    this.schedules.set(schedule.id, schedule);
    this.scheduleKeys.set(key, schedule.id);
  }

  async findScheduleById(id: ScheduleId): Promise<Schedule | null> {
    return this.schedules.get(id) ?? null;
  }

  async findScheduleByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ScheduleId,
  ): Promise<Schedule | null> {
    const schedule = this.schedules.get(id);
    if (schedule === undefined || schedule.workspaceId !== workspaceId) {
      return null;
    }

    return schedule;
  }

  async findScheduleByWorkspaceKey(
    workspaceId: WorkspaceId,
    key: string,
  ): Promise<Schedule | null> {
    const scheduleId = this.scheduleKeys.get(
      workspaceScheduleKey(workspaceId, key),
    );
    if (scheduleId === undefined) {
      return null;
    }

    return this.schedules.get(scheduleId) ?? null;
  }

  async updateSchedule(schedule: Schedule): Promise<void> {
    if (!this.schedules.has(schedule.id)) {
      throw new ScheduleNotFoundError(schedule.id);
    }

    this.schedules.set(schedule.id, schedule);
  }

  async listSchedules(query: ListSchedulesQuery): Promise<ListSchedulesResult> {
    const filtered = [...this.schedules.values()].filter((schedule) => {
      if (schedule.workspaceId !== query.workspaceId) {
        return false;
      }

      if (
        query.cursor !== undefined &&
        !isAfterScheduleCursor(schedule, query.cursor)
      ) {
        return false;
      }

      return true;
    });

    filtered.sort(compareSchedulesCreatedAtIdDesc);
    const page = filtered.slice(0, query.limit);
    const hasMore = filtered.length > query.limit;
    const last = page[page.length - 1];

    return {
      schedules: page,
      nextCursor:
        hasMore && last !== undefined
          ? { createdAt: last.createdAt, id: last.id }
          : undefined,
    };
  }

  async materializeDueOccurrences(
    now: Date,
    limit: number,
    createOccurrenceId: () => ScheduleOccurrenceId,
  ): Promise<readonly ScheduleOccurrence[]> {
    const due = [...this.schedules.values()]
      .filter(
        (schedule) =>
          schedule.enabled &&
          schedule.nextRunAt !== null &&
          schedule.nextRunAt.getTime() <= now.getTime(),
      )
      .sort(compareSchedulesNextRunAtIdAsc)
      .slice(0, limit);

    const materialized: ScheduleOccurrence[] = [];

    for (const schedule of due) {
      if (schedule.nextRunAt === null) {
        continue;
      }

      const scheduledFor = schedule.nextRunAt;
      const uniqueKey = occurrenceUniqueKey(schedule.id, scheduledFor);
      if (this.occurrenceUniqueKeys.has(uniqueKey)) {
        continue;
      }

      const occurrence = ScheduleOccurrence.create({
        id: createOccurrenceId(),
        scheduleId: schedule.id,
        workspaceId: schedule.workspaceId,
        agentId: schedule.agentId,
        agentVersionId: schedule.agentVersionId,
        input: schedule.input,
        scheduledFor,
        createdAt: now,
      });

      const updatedSchedule = Schedule.rehydrate({
        id: schedule.id,
        workspaceId: schedule.workspaceId,
        key: schedule.key,
        name: schedule.name,
        agentId: schedule.agentId,
        agentVersionId: schedule.agentVersionId,
        cronExpression: schedule.cronExpression,
        timezone: schedule.timezone,
        input: schedule.input,
        enabled: schedule.enabled,
        nextRunAt: nextCronInstantAfter(
          schedule.cronExpression,
          schedule.timezone,
          now,
        ),
        createdAt: schedule.createdAt,
        updatedAt: now,
      });

      this.schedules.set(schedule.id, updatedSchedule);
      this.occurrences.set(occurrence.id, occurrence);
      this.occurrenceUniqueKeys.add(uniqueKey);
      materialized.push(occurrence);
    }

    return materialized;
  }

  async listUndispatchedOccurrences(
    limit: number,
  ): Promise<readonly ScheduleOccurrence[]> {
    return [...this.occurrences.values()]
      .filter((occurrence) => occurrence.dispatchedAt === null)
      .sort(compareOccurrencesScheduledForIdAsc)
      .slice(0, limit);
  }

  async listOccurrencesForSchedule(
    query: ListScheduleOccurrencesQuery,
  ): Promise<ListScheduleOccurrencesResult> {
    const filtered = [...this.occurrences.values()].filter((occurrence) => {
      if (occurrence.scheduleId !== query.scheduleId) {
        return false;
      }

      if (
        query.cursor !== undefined &&
        !isBeforeOccurrenceCursor(occurrence, query.cursor)
      ) {
        return false;
      }

      return true;
    });

    filtered.sort(compareOccurrencesScheduledForIdDesc);
    const page = filtered.slice(0, query.limit);
    const hasMore = filtered.length > query.limit;
    const last = page[page.length - 1];

    return {
      occurrences: page,
      nextCursor:
        hasMore && last !== undefined
          ? { scheduledFor: last.scheduledFor, id: last.id }
          : undefined,
    };
  }

  async findOccurrenceById(
    id: ScheduleOccurrenceId,
  ): Promise<ScheduleOccurrence | null> {
    return this.occurrences.get(id) ?? null;
  }

  async attachOccurrenceRunId(
    occurrenceId: ScheduleOccurrenceId,
    runId: RunId,
  ): Promise<ScheduleOccurrence> {
    const existing = this.occurrences.get(occurrenceId);
    if (existing === undefined) {
      throw new DomainInvariantError(
        `ScheduleOccurrence ${occurrenceId} was not found.`,
      );
    }

    if (existing.runId !== null && existing.runId !== runId) {
      throw new DomainInvariantError(
        `ScheduleOccurrence ${occurrenceId} is already attached to Run ${existing.runId}.`,
      );
    }

    const updated = existing.withRunId(runId);
    this.occurrences.set(occurrenceId, updated);
    return updated;
  }

  async markOccurrenceDispatched(
    occurrenceId: ScheduleOccurrenceId,
    dispatchedAt: Date,
  ): Promise<ScheduleOccurrence> {
    const existing = this.occurrences.get(occurrenceId);
    if (existing === undefined) {
      throw new DomainInvariantError(
        `ScheduleOccurrence ${occurrenceId} was not found.`,
      );
    }

    if (existing.dispatchedAt !== null) {
      return existing;
    }

    const updated = existing.withDispatchedAt(dispatchedAt);
    this.occurrences.set(occurrenceId, updated);
    return updated;
  }
}

function workspaceScheduleKey(workspaceId: WorkspaceId, key: string): string {
  return `${workspaceId}:${key}`;
}

function occurrenceUniqueKey(
  scheduleId: ScheduleId,
  scheduledFor: Date,
): string {
  return `${scheduleId}:${scheduledFor.toISOString()}`;
}

function compareSchedulesNextRunAtIdAsc(
  left: Schedule,
  right: Schedule,
): number {
  const leftNext = left.nextRunAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const rightNext = right.nextRunAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (leftNext !== rightNext) {
    return leftNext - rightNext;
  }

  return left.id.localeCompare(right.id);
}

function compareSchedulesCreatedAtIdDesc(
  left: Schedule,
  right: Schedule,
): number {
  const createdDelta = right.createdAt.getTime() - left.createdAt.getTime();
  if (createdDelta !== 0) {
    return createdDelta;
  }

  return right.id.localeCompare(left.id);
}

function compareOccurrencesScheduledForIdAsc(
  left: ScheduleOccurrence,
  right: ScheduleOccurrence,
): number {
  const scheduledDelta =
    left.scheduledFor.getTime() - right.scheduledFor.getTime();
  if (scheduledDelta !== 0) {
    return scheduledDelta;
  }

  return left.id.localeCompare(right.id);
}

function compareOccurrencesScheduledForIdDesc(
  left: ScheduleOccurrence,
  right: ScheduleOccurrence,
): number {
  return -compareOccurrencesScheduledForIdAsc(left, right);
}

function isAfterScheduleCursor(
  schedule: Schedule,
  cursor: { readonly createdAt: Date; readonly id: ScheduleId },
): boolean {
  if (schedule.createdAt.getTime() < cursor.createdAt.getTime()) {
    return true;
  }

  return (
    schedule.createdAt.getTime() === cursor.createdAt.getTime() &&
    schedule.id < cursor.id
  );
}

function isBeforeOccurrenceCursor(
  occurrence: ScheduleOccurrence,
  cursor: ScheduleOccurrenceListCursor,
): boolean {
  if (occurrence.scheduledFor.getTime() < cursor.scheduledFor.getTime()) {
    return true;
  }

  return (
    occurrence.scheduledFor.getTime() === cursor.scheduledFor.getTime() &&
    occurrence.id < cursor.id
  );
}
