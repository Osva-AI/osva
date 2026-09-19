import type { WorkflowWait } from "@osva/domain";
import { and, asc, eq, gte, lte } from "drizzle-orm";

import type { Database } from "../database.js";
import { workflowEventFromRow } from "../mappers/workflow-event-mapper.js";
import { workflowEvents } from "../schema/workflow-events.js";

type DbExecutor = Pick<Database["db"], "select">;

export async function selectWorkflowEventCandidatesForWait(
  executor: DbExecutor,
  wait: WorkflowWait,
  now: Date,
) {
  if (
    wait.kind !== "EVENT" ||
    wait.eventSource === undefined ||
    wait.eventType === undefined ||
    wait.correlationKey === undefined ||
    wait.eligibleFrom === undefined
  ) {
    return [];
  }

  const conditions = [
    eq(workflowEvents.workspaceId, wait.workspaceId),
    eq(workflowEvents.source, wait.eventSource),
    eq(workflowEvents.eventType, wait.eventType),
    eq(workflowEvents.correlationKey, wait.correlationKey),
    gte(workflowEvents.receivedAt, wait.eligibleFrom),
    lte(workflowEvents.receivedAt, now),
  ];

  if (wait.expiresAt !== undefined) {
    conditions.push(lte(workflowEvents.receivedAt, wait.expiresAt));
  }

  const rows = await executor
    .select()
    .from(workflowEvents)
    .where(and(...conditions))
    .orderBy(asc(workflowEvents.receivedAt), asc(workflowEvents.id));

  return rows.map(workflowEventFromRow);
}
