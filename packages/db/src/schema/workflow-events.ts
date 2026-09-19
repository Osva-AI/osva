import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { workspaces } from "./workspaces.js";

export const workflowEvents = pgTable(
  "workflow_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    source: text("source").notNull(),
    eventType: text("event_type").notNull(),
    correlationKey: text("correlation_key").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("workflow_events_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    unique("workflow_events_workspace_id_source_idempotency_key_unique").on(
      table.workspaceId,
      table.source,
      table.idempotencyKey,
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "workflow_events_workspace_id_workspaces_id_fk",
    }),
    index("workflow_events_candidate_lookup_idx").on(
      table.workspaceId,
      table.source,
      table.eventType,
      table.correlationKey,
      table.receivedAt,
      table.id,
    ),
    check(
      "workflow_events_source_nonempty",
      sql`char_length(${table.source}) > 0`,
    ),
    check(
      "workflow_events_event_type_nonempty",
      sql`char_length(${table.eventType}) > 0`,
    ),
    check(
      "workflow_events_correlation_key_nonempty",
      sql`char_length(${table.correlationKey}) > 0`,
    ),
    check(
      "workflow_events_idempotency_key_nonempty",
      sql`char_length(${table.idempotencyKey}) > 0`,
    ),
  ],
);
