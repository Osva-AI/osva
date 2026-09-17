import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { runs } from "./runs.js";
import { sqlTextInList } from "./sql.js";
import { PERSISTED_WORKFLOW_NODE_RUN_STATES } from "./states.js";
import { workflowRuns } from "./workflow-runs.js";

export const workflowNodeRuns = pgTable(
  "workflow_node_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    workflowRunId: text("workflow_run_id").notNull(),
    workflowNodeKey: text("workflow_node_key").notNull(),
    sequence: integer("sequence").notNull(),
    status: text("status").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    childRunId: text("child_run_id"),
    selectedTargetKey: text("selected_target_key"),
    error: jsonb("error").$type<{ code: string; message: string }>(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("workflow_node_runs_workflow_run_id_key_unique").on(
      table.workflowRunId,
      table.workflowNodeKey,
    ),
    unique("workflow_node_runs_workflow_run_id_sequence_unique").on(
      table.workflowRunId,
      table.sequence,
    ),
    unique("workflow_node_runs_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("workflow_node_runs_child_run_id_unique")
      .on(table.childRunId)
      .where(sql`${table.childRunId} is not null`),
    foreignKey({
      columns: [table.workspaceId, table.workflowRunId],
      foreignColumns: [workflowRuns.workspaceId, workflowRuns.id],
      name: "workflow_node_runs_workspace_id_workflow_run_id_fk",
    }),
    foreignKey({
      columns: [table.childRunId],
      foreignColumns: [runs.id],
      name: "workflow_node_runs_child_run_id_runs_fk",
    }),
    check("workflow_node_runs_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "workflow_node_runs_status_check",
      sql`${table.status} in (${sqlTextInList(PERSISTED_WORKFLOW_NODE_RUN_STATES)})`,
    ),
  ],
);
