import {
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import {
  PERSISTED_ASSIGNMENT_STATES,
  PERSISTED_ASSIGNMENT_TARGET_TYPES,
} from "./states.js";
import { goals } from "./goals.js";
import { officeWorkers } from "./office-workers.js";
import { runs } from "./runs.js";
import { workflowRuns } from "./workflow-runs.js";
import { workspaces } from "./workspaces.js";

export const assignments = pgTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    goalId: text("goal_id").references(() => goals.id),
    officeWorkerId: text("office_worker_id")
      .notNull()
      .references(() => officeWorkers.id),
    title: text("title").notNull(),
    description: text("description"),
    targetType: text("target_type", {
      enum: PERSISTED_ASSIGNMENT_TARGET_TYPES,
    }).notNull(),
    targetVersionId: text("target_version_id").notNull(),
    input: jsonb("input").notNull(),
    status: text("status", { enum: PERSISTED_ASSIGNMENT_STATES }).notNull(),
    runId: text("run_id").references(() => runs.id),
    workflowRunId: text("workflow_run_id").references(() => workflowRuns.id),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    unique("assignments_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    foreignKey({
      columns: [table.workspaceId, table.officeWorkerId],
      foreignColumns: [officeWorkers.workspaceId, officeWorkers.id],
      name: "assignments_workspace_id_office_worker_id_office_workers_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.goalId],
      foreignColumns: [goals.workspaceId, goals.id],
      name: "assignments_workspace_id_goal_id_goals_fk",
    }),
  ],
);
