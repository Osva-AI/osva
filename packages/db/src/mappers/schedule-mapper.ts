import type {
  AgentId,
  AgentVersionId,
  JsonValue,
  ScheduleId,
  WorkspaceId,
} from "@osva/contracts";
import { Schedule } from "@osva/domain";

import type { schedules } from "../schema/schedules.js";
import { toDomainDate } from "./timestamps.js";

type ScheduleRow = typeof schedules.$inferSelect;

export function scheduleToRow(schedule: Schedule) {
  return {
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
    nextRunAt: schedule.nextRunAt,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  };
}

export function scheduleFromRow(row: ScheduleRow): Schedule {
  return Schedule.rehydrate({
    id: row.id as ScheduleId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    name: row.name,
    agentId: row.agentId as AgentId,
    agentVersionId: row.agentVersionId as AgentVersionId,
    cronExpression: row.cronExpression,
    timezone: row.timezone,
    input: row.input as JsonValue,
    enabled: row.enabled,
    nextRunAt: row.nextRunAt === null ? null : toDomainDate(row.nextRunAt),
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}
