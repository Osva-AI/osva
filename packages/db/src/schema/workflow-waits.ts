import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { sqlTextInList } from "./sql.js";
import {
  PERSISTED_WORKFLOW_WAIT_KINDS,
  PERSISTED_WORKFLOW_WAIT_RESOLUTIONS,
} from "./states.js";
import { workflowEvents } from "./workflow-events.js";
import { workflowNodeRuns } from "./workflow-node-runs.js";

export const workflowWaits = pgTable(
  "workflow_waits",
  {
    workflowNodeRunId: text("workflow_node_run_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    workflowRunId: text("workflow_run_id").notNull(),
    kind: text("kind").notNull(),
    armedAt: timestamp("armed_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    resolution: text("resolution"),
    resolvedAt: timestamp("resolved_at", {
      withTimezone: true,
      mode: "date",
    }),
    resolvedByEventId: text("resolved_by_event_id"),
    wakeAt: timestamp("wake_at", {
      withTimezone: true,
      mode: "date",
    }),
    eventSource: text("event_source"),
    eventType: text("event_type"),
    correlationKey: text("correlation_key"),
    eligibleFrom: timestamp("eligible_from", {
      withTimezone: true,
      mode: "date",
    }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    foreignKey({
      columns: [
        table.workspaceId,
        table.workflowRunId,
        table.workflowNodeRunId,
      ],
      foreignColumns: [
        workflowNodeRuns.workspaceId,
        workflowNodeRuns.workflowRunId,
        workflowNodeRuns.id,
      ],
      name: "workflow_waits_workspace_id_workflow_run_id_node_run_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.resolvedByEventId],
      foreignColumns: [workflowEvents.workspaceId, workflowEvents.id],
      name: "workflow_waits_workspace_id_resolved_by_event_id_fk",
    }),
    index("workflow_waits_workflow_run_id_node_run_id_idx").on(
      table.workflowRunId,
      table.workflowNodeRunId,
    ),
    index("workflow_waits_timer_due_idx")
      .on(table.wakeAt, table.workflowNodeRunId)
      .where(sql`${table.kind} = 'TIMER' and ${table.resolution} is null`),
    index("workflow_waits_event_timeout_idx")
      .on(table.expiresAt, table.workflowNodeRunId)
      .where(
        sql`${table.kind} = 'EVENT' and ${table.resolution} is null and ${table.expiresAt} is not null`,
      ),
    index("workflow_waits_event_match_idx")
      .on(
        table.workspaceId,
        table.eventSource,
        table.eventType,
        table.correlationKey,
        table.workflowNodeRunId,
      )
      .where(sql`${table.kind} = 'EVENT' and ${table.resolution} is null`),
    check(
      "workflow_waits_kind_check",
      sql`${table.kind} in (${sqlTextInList(PERSISTED_WORKFLOW_WAIT_KINDS)})`,
    ),
    check(
      "workflow_waits_resolution_check",
      sql`${table.resolution} is null or ${table.resolution} in (${sqlTextInList(PERSISTED_WORKFLOW_WAIT_RESOLUTIONS)})`,
    ),
    check(
      "workflow_waits_resolution_timestamps_check",
      sql`(
        ${table.resolution} is null
        and ${table.resolvedAt} is null
        and ${table.resolvedByEventId} is null
      ) or (
        ${table.resolution} is not null
        and ${table.resolvedAt} is not null
        and ${table.resolvedAt} >= ${table.armedAt}
      )`,
    ),
    check(
      "workflow_waits_resolution_event_id_check",
      sql`(
        ${table.resolution} = 'EVENT'
        and ${table.resolvedByEventId} is not null
      ) or (
        ${table.resolution} is distinct from 'EVENT'
        and ${table.resolvedByEventId} is null
      )`,
    ),
    check(
      "workflow_waits_timer_kind_check",
      sql`${table.kind} <> 'TIMER' or (
        ${table.wakeAt} is not null
        and ${table.eventSource} is null
        and ${table.eventType} is null
        and ${table.correlationKey} is null
        and ${table.eligibleFrom} is null
        and ${table.expiresAt} is null
        and (
          ${table.resolution} is null
          or ${table.resolution} in ('TIMER', 'CANCELLED')
        )
      )`,
    ),
    check(
      "workflow_waits_event_kind_check",
      sql`${table.kind} <> 'EVENT' or (
        ${table.wakeAt} is null
        and ${table.eventSource} is not null
        and char_length(${table.eventSource}) > 0
        and ${table.eventType} is not null
        and char_length(${table.eventType}) > 0
        and ${table.correlationKey} is not null
        and char_length(${table.correlationKey}) > 0
        and ${table.eligibleFrom} is not null
        and ${table.eligibleFrom} <= ${table.armedAt}
        and (
          ${table.expiresAt} is null
          or ${table.expiresAt} > ${table.armedAt}
        )
        and (
          ${table.resolution} is null
          or ${table.resolution} in ('EVENT', 'TIMEOUT', 'CANCELLED')
        )
        and (
          ${table.resolution} is distinct from 'TIMEOUT'
          or ${table.expiresAt} is not null
        )
      )`,
    ),
  ],
);
