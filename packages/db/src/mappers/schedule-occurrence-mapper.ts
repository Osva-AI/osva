import type {
  AgentId,
  AgentVersionId,
  JsonValue,
  RunId,
  ScheduleId,
  ScheduleOccurrenceId,
  WorkspaceId,
} from "@osva/contracts";
import { ScheduleOccurrence } from "@osva/domain";

import type { scheduleOccurrences } from "../schema/schedule-occurrences.js";
import { toDomainDate } from "./timestamps.js";

type ScheduleOccurrenceRow = typeof scheduleOccurrences.$inferSelect;

export function scheduleOccurrenceToRow(occurrence: ScheduleOccurrence) {
  return {
    id: occurrence.id,
    scheduleId: occurrence.scheduleId,
    workspaceId: occurrence.workspaceId,
    agentId: occurrence.agentId,
    agentVersionId: occurrence.agentVersionId,
    input: occurrence.input,
    scheduledFor: occurrence.scheduledFor,
    runId: occurrence.runId,
    createdAt: occurrence.createdAt,
    dispatchedAt: occurrence.dispatchedAt,
  };
}

export function scheduleOccurrenceFromRow(
  row: ScheduleOccurrenceRow,
): ScheduleOccurrence {
  return ScheduleOccurrence.rehydrate({
    id: row.id as ScheduleOccurrenceId,
    scheduleId: row.scheduleId as ScheduleId,
    workspaceId: row.workspaceId as WorkspaceId,
    agentId: row.agentId as AgentId,
    agentVersionId: row.agentVersionId as AgentVersionId,
    input: row.input as JsonValue,
    scheduledFor: toDomainDate(row.scheduledFor),
    runId: (row.runId as RunId | null) ?? null,
    createdAt: toDomainDate(row.createdAt),
    dispatchedAt:
      row.dispatchedAt === null ? null : toDomainDate(row.dispatchedAt),
  });
}
