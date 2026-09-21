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
  type ScheduleRepository,
} from "@osva/domain";
import { and, asc, desc, eq, isNull, lt, lte, or } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  scheduleOccurrenceFromRow,
  scheduleOccurrenceToRow,
} from "../mappers/schedule-occurrence-mapper.js";
import { scheduleFromRow, scheduleToRow } from "../mappers/schedule-mapper.js";
import {
  POSTGRES_UNIQUE_VIOLATION,
  mapDatabaseError,
  postgresConstraintName,
  postgresErrorCode,
} from "../postgres-errors.js";
import { scheduleOccurrences } from "../schema/schedule-occurrences.js";
import { schedules } from "../schema/schedules.js";

export class PostgresScheduleRepository implements ScheduleRepository {
  constructor(private readonly database: Database) {}

  async saveSchedule(schedule: Schedule): Promise<void> {
    try {
      await this.database.db.insert(schedules).values(scheduleToRow(schedule));
    } catch (error) {
      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) === "schedules_workspace_id_key_unique"
      ) {
        throw new DuplicateScheduleKeyError(schedule.workspaceId, schedule.key);
      }

      throw mapDatabaseError(error, {
        schedules_workspace_id_key_unique: `Schedule key '${schedule.key}' already exists in workspace '${schedule.workspaceId}'.`,
        schedules_workspace_id_agent_id_agents_fk: `Agent '${schedule.agentId}' does not belong to workspace '${schedule.workspaceId}'.`,
        schedules_agent_id_agent_version_id_agent_versions_fk: `AgentVersion '${schedule.agentVersionId}' does not belong to Agent '${schedule.agentId}'.`,
      });
    }
  }

  async findScheduleById(id: ScheduleId): Promise<Schedule | null> {
    const [row] = await this.database.db
      .select()
      .from(schedules)
      .where(eq(schedules.id, id))
      .limit(1);

    return row === undefined ? null : scheduleFromRow(row);
  }

  async findScheduleByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ScheduleId,
  ): Promise<Schedule | null> {
    const [row] = await this.database.db
      .select()
      .from(schedules)
      .where(and(eq(schedules.id, id), eq(schedules.workspaceId, workspaceId)))
      .limit(1);

    return row === undefined ? null : scheduleFromRow(row);
  }

  async findScheduleByWorkspaceKey(
    workspaceId: WorkspaceId,
    key: string,
  ): Promise<Schedule | null> {
    const [row] = await this.database.db
      .select()
      .from(schedules)
      .where(
        and(eq(schedules.workspaceId, workspaceId), eq(schedules.key, key)),
      )
      .limit(1);

    return row === undefined ? null : scheduleFromRow(row);
  }

  async updateSchedule(schedule: Schedule): Promise<void> {
    const row = scheduleToRow(schedule);
    const updated = await this.database.db
      .update(schedules)
      .set({
        name: row.name,
        agentVersionId: row.agentVersionId,
        cronExpression: row.cronExpression,
        timezone: row.timezone,
        input: row.input,
        enabled: row.enabled,
        nextRunAt: row.nextRunAt,
        updatedAt: row.updatedAt,
      })
      .where(eq(schedules.id, schedule.id))
      .returning({ id: schedules.id });

    if (updated.length === 0) {
      throw new ScheduleNotFoundError(schedule.id);
    }
  }

  async listSchedules(query: ListSchedulesQuery): Promise<ListSchedulesResult> {
    const conditions = [eq(schedules.workspaceId, query.workspaceId)];

    if (query.cursor !== undefined) {
      const cursorCondition = or(
        lt(schedules.createdAt, query.cursor.createdAt),
        and(
          eq(schedules.createdAt, query.cursor.createdAt),
          lt(schedules.id, query.cursor.id),
        ),
      );
      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }

    const rows = await this.database.db
      .select()
      .from(schedules)
      .where(and(...conditions))
      .orderBy(desc(schedules.createdAt), desc(schedules.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      schedules: page.map(scheduleFromRow),
      nextCursor:
        hasMore && last !== undefined
          ? { createdAt: last.createdAt, id: last.id as ScheduleId }
          : undefined,
    };
  }

  async materializeDueOccurrences(
    now: Date,
    limit: number,
    createOccurrenceId: () => ScheduleOccurrenceId,
  ): Promise<readonly ScheduleOccurrence[]> {
    const materialized: ScheduleOccurrence[] = [];

    for (let index = 0; index < limit; index += 1) {
      const occurrence = await this.database.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schedules)
          .where(
            and(eq(schedules.enabled, true), lte(schedules.nextRunAt, now)),
          )
          .orderBy(asc(schedules.nextRunAt), asc(schedules.id))
          .limit(1)
          .for("update", { skipLocked: true });

        if (row === undefined) {
          return null;
        }

        const schedule = scheduleFromRow(row);
        if (
          schedule.nextRunAt === null ||
          schedule.nextRunAt.getTime() > now.getTime()
        ) {
          return null;
        }

        const scheduledFor = schedule.nextRunAt;
        const occurrenceEntity = ScheduleOccurrence.create({
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

        try {
          await tx
            .insert(scheduleOccurrences)
            .values(scheduleOccurrenceToRow(occurrenceEntity));
          await tx
            .update(schedules)
            .set(scheduleToRow(updatedSchedule))
            .where(eq(schedules.id, schedule.id));
        } catch (error) {
          if (
            postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
            postgresConstraintName(error) ===
              "schedule_occurrences_schedule_id_scheduled_for_unique"
          ) {
            return null;
          }

          throw error;
        }

        return occurrenceEntity;
      });

      if (occurrence === null) {
        break;
      }

      materialized.push(occurrence);
    }

    return materialized;
  }

  async listUndispatchedOccurrences(
    limit: number,
  ): Promise<readonly ScheduleOccurrence[]> {
    const rows = await this.database.db
      .select()
      .from(scheduleOccurrences)
      .where(isNull(scheduleOccurrences.dispatchedAt))
      .orderBy(
        asc(scheduleOccurrences.scheduledFor),
        asc(scheduleOccurrences.id),
      )
      .limit(limit);

    return rows.map(scheduleOccurrenceFromRow);
  }

  async listOccurrencesForSchedule(
    query: ListScheduleOccurrencesQuery,
  ): Promise<ListScheduleOccurrencesResult> {
    const conditions = [eq(scheduleOccurrences.scheduleId, query.scheduleId)];

    if (query.cursor !== undefined) {
      const cursorCondition = or(
        lt(scheduleOccurrences.scheduledFor, query.cursor.scheduledFor),
        and(
          eq(scheduleOccurrences.scheduledFor, query.cursor.scheduledFor),
          lt(scheduleOccurrences.id, query.cursor.id),
        ),
      );
      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }

    const rows = await this.database.db
      .select()
      .from(scheduleOccurrences)
      .where(and(...conditions))
      .orderBy(
        desc(scheduleOccurrences.scheduledFor),
        desc(scheduleOccurrences.id),
      )
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      occurrences: page.map(scheduleOccurrenceFromRow),
      nextCursor:
        hasMore && last !== undefined
          ? {
              scheduledFor: last.scheduledFor,
              id: last.id as ScheduleOccurrenceId,
            }
          : undefined,
    };
  }

  async findOccurrenceById(
    id: ScheduleOccurrenceId,
  ): Promise<ScheduleOccurrence | null> {
    const [row] = await this.database.db
      .select()
      .from(scheduleOccurrences)
      .where(eq(scheduleOccurrences.id, id))
      .limit(1);

    return row === undefined ? null : scheduleOccurrenceFromRow(row);
  }

  async attachOccurrenceRunId(
    occurrenceId: ScheduleOccurrenceId,
    runId: RunId,
  ): Promise<ScheduleOccurrence> {
    const [row] = await this.database.db
      .update(scheduleOccurrences)
      .set({ runId })
      .where(
        and(
          eq(scheduleOccurrences.id, occurrenceId),
          or(
            isNull(scheduleOccurrences.runId),
            eq(scheduleOccurrences.runId, runId),
          ),
        ),
      )
      .returning();

    if (row === undefined) {
      const existing = await this.findOccurrenceById(occurrenceId);
      if (existing === null) {
        throw new DomainInvariantError(
          `ScheduleOccurrence ${occurrenceId} was not found.`,
        );
      }

      if (existing.runId !== null && existing.runId !== runId) {
        throw new DomainInvariantError(
          `ScheduleOccurrence ${occurrenceId} is already attached to Run ${existing.runId}.`,
        );
      }

      return existing;
    }

    return scheduleOccurrenceFromRow(row);
  }

  async markOccurrenceDispatched(
    occurrenceId: ScheduleOccurrenceId,
    dispatchedAt: Date,
  ): Promise<ScheduleOccurrence> {
    const [row] = await this.database.db
      .update(scheduleOccurrences)
      .set({ dispatchedAt })
      .where(
        and(
          eq(scheduleOccurrences.id, occurrenceId),
          isNull(scheduleOccurrences.dispatchedAt),
        ),
      )
      .returning();

    if (row === undefined) {
      const existing = await this.findOccurrenceById(occurrenceId);
      if (existing === null) {
        throw new DomainInvariantError(
          `ScheduleOccurrence ${occurrenceId} was not found.`,
        );
      }

      return existing;
    }

    return scheduleOccurrenceFromRow(row);
  }
}
