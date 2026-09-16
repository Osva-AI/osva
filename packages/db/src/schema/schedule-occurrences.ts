import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { runs } from "./runs.js";
import { schedules } from "./schedules.js";

export const scheduleOccurrences = pgTable(
  "schedule_occurrences",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    agentVersionId: text("agent_version_id").notNull(),
    input: jsonb("input").notNull(),
    scheduledFor: timestamp("scheduled_for", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    runId: text("run_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    dispatchedAt: timestamp("dispatched_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    uniqueIndex("schedule_occurrences_schedule_id_scheduled_for_unique").on(
      table.scheduleId,
      table.scheduledFor,
    ),
    index("schedule_occurrences_schedule_scheduled_for_id_idx").on(
      table.scheduleId,
      table.scheduledFor,
      table.id,
    ),
    index("schedule_occurrences_dispatched_at_scheduled_for_id_idx").on(
      table.dispatchedAt,
      table.scheduledFor,
      table.id,
    ),
    foreignKey({
      columns: [table.scheduleId],
      foreignColumns: [schedules.id],
      name: "schedule_occurrences_schedule_id_schedules_id_fk",
    }),
    foreignKey({
      columns: [table.runId],
      foreignColumns: [runs.id],
      name: "schedule_occurrences_run_id_runs_id_fk",
    }),
  ],
);
