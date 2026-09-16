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

import { sqlTextInList } from "./sql.js";
import { PERSISTED_WORKFLOW_RUN_STATES } from "./states.js";
import { workflowVersions } from "./workflow-versions.js";
import { workflows } from "./workflows.js";

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    workflowVersionId: text("workflow_version_id").notNull(),
    status: text("status").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
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
    unique("workflow_runs_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    foreignKey({
      columns: [table.workspaceId, table.workflowId],
      foreignColumns: [workflows.workspaceId, workflows.id],
      name: "workflow_runs_workspace_id_workflow_id_workflows_fk",
    }),
    foreignKey({
      columns: [table.workflowId, table.workflowVersionId],
      foreignColumns: [workflowVersions.workflowId, workflowVersions.id],
      name: "workflow_runs_workflow_id_workflow_version_id_fk",
    }),
    index("workflow_runs_status_created_at_id_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
    check(
      "workflow_runs_status_check",
      sql`${table.status} in (${sqlTextInList(PERSISTED_WORKFLOW_RUN_STATES)})`,
    ),
  ],
);
