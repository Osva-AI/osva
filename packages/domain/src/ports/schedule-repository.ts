import type {
  ScheduleId,
  ScheduleOccurrenceId,
  WorkspaceId,
} from "@osva/contracts";

import type { Schedule } from "../schedule.js";
import type { ScheduleOccurrence } from "../schedule-occurrence.js";

export const DEFAULT_SCHEDULE_LIST_LIMIT = 50;
export const MAX_SCHEDULE_LIST_LIMIT = 100;

export const DEFAULT_SCHEDULE_OCCURRENCE_LIST_LIMIT = 50;
export const MAX_SCHEDULE_OCCURRENCE_LIST_LIMIT = 100;

export interface ScheduleListCursor {
  readonly createdAt: Date;
  readonly id: ScheduleId;
}

export interface ScheduleOccurrenceListCursor {
  readonly scheduledFor: Date;
  readonly id: ScheduleOccurrenceId;
}

export interface ListSchedulesQuery {
  readonly workspaceId: WorkspaceId;
  readonly limit: number;
  readonly cursor?: ScheduleListCursor;
}

export interface ListSchedulesResult {
  readonly schedules: readonly Schedule[];
  readonly nextCursor?: ScheduleListCursor;
}

export interface ListScheduleOccurrencesQuery {
  readonly scheduleId: ScheduleId;
  readonly limit: number;
  readonly cursor?: ScheduleOccurrenceListCursor;
}

export interface ListScheduleOccurrencesResult {
  readonly occurrences: readonly ScheduleOccurrence[];
  readonly nextCursor?: ScheduleOccurrenceListCursor;
}

export interface ScheduleRepository {
  saveSchedule(schedule: Schedule): Promise<void>;
  findScheduleById(id: ScheduleId): Promise<Schedule | null>;
  findScheduleByWorkspaceKey(
    workspaceId: WorkspaceId,
    key: string,
  ): Promise<Schedule | null>;
  updateSchedule(schedule: Schedule): Promise<void>;
  listSchedules(query: ListSchedulesQuery): Promise<ListSchedulesResult>;
  materializeDueOccurrences(
    now: Date,
    limit: number,
    createOccurrenceId: () => ScheduleOccurrenceId,
  ): Promise<readonly ScheduleOccurrence[]>;
  listUndispatchedOccurrences(
    limit: number,
  ): Promise<readonly ScheduleOccurrence[]>;
  listOccurrencesForSchedule(
    query: ListScheduleOccurrencesQuery,
  ): Promise<ListScheduleOccurrencesResult>;
  findOccurrenceById(
    id: ScheduleOccurrenceId,
  ): Promise<ScheduleOccurrence | null>;
  attachOccurrenceRunId(
    occurrenceId: ScheduleOccurrenceId,
    runId: NonNullable<ScheduleOccurrence["runId"]>,
  ): Promise<ScheduleOccurrence>;
  markOccurrenceDispatched(
    occurrenceId: ScheduleOccurrenceId,
    dispatchedAt: Date,
  ): Promise<ScheduleOccurrence>;
}
