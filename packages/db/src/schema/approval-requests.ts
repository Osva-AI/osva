import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { sqlTextInList } from "./sql.js";
import { PERSISTED_APPROVAL_REQUEST_STATES } from "./states.js";
import { workflowNodeRuns } from "./workflow-node-runs.js";
import { workflowRuns } from "./workflow-runs.js";

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    workflowRunId: text("workflow_run_id").notNull(),
    workflowNodeRunId: text("workflow_node_run_id").notNull(),
    status: text("status").notNull(),
    decisionComment: text("decision_comment"),
    decidedAt: timestamp("decided_at", {
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
    unique("approval_requests_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    unique("approval_requests_workflow_node_run_id_unique").on(
      table.workflowNodeRunId,
    ),
    foreignKey({
      columns: [table.workspaceId, table.workflowRunId],
      foreignColumns: [workflowRuns.workspaceId, workflowRuns.id],
      name: "approval_requests_workspace_id_workflow_run_id_fk",
    }),
    foreignKey({
      columns: [table.workspaceId, table.workflowNodeRunId],
      foreignColumns: [workflowNodeRuns.workspaceId, workflowNodeRuns.id],
      name: "approval_requests_workspace_id_workflow_node_run_id_fk",
    }),
    index("approval_requests_workflow_run_id_idx").on(table.workflowRunId),
    index("approval_requests_workspace_id_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    check(
      "approval_requests_status_check",
      sql`${table.status} in (${sqlTextInList(PERSISTED_APPROVAL_REQUEST_STATES)})`,
    ),
  ],
);
