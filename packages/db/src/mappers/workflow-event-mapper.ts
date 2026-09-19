import type { JsonValue, WorkflowEventId, WorkspaceId } from "@osva/contracts";
import { WorkflowEvent } from "@osva/domain";

import type { workflowEvents } from "../schema/workflow-events.js";
import { toDomainDate, toOptionalDomainDate } from "./timestamps.js";

type WorkflowEventRow = typeof workflowEvents.$inferSelect;

export function workflowEventToRow(event: WorkflowEvent) {
  return {
    id: event.id,
    workspaceId: event.workspaceId,
    source: event.source,
    eventType: event.eventType,
    correlationKey: event.correlationKey,
    idempotencyKey: event.idempotencyKey,
    payload: event.payload,
    occurredAt: event.occurredAt ?? null,
    receivedAt: event.receivedAt,
  };
}

export function workflowEventFromRow(row: WorkflowEventRow): WorkflowEvent {
  return WorkflowEvent.rehydrate({
    id: row.id as WorkflowEventId,
    workspaceId: row.workspaceId as WorkspaceId,
    source: row.source,
    eventType: row.eventType,
    correlationKey: row.correlationKey,
    idempotencyKey: row.idempotencyKey,
    payload: row.payload as JsonValue,
    occurredAt: toOptionalDomainDate(row.occurredAt),
    receivedAt: toDomainDate(row.receivedAt),
  });
}
