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
} from "drizzle-orm/pg-core";

import { workflows } from "./workflows.js";

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id),
    workspaceId: text("workspace_id").notNull(),
    version: integer("version").notNull(),
    definition: jsonb("definition")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("workflow_versions_workflow_id_version_unique").on(
      table.workflowId,
      table.version,
    ),
    unique("workflow_versions_workflow_id_id_unique").on(
      table.workflowId,
      table.id,
    ),
    foreignKey({
      columns: [table.workspaceId, table.workflowId],
      foreignColumns: [workflows.workspaceId, workflows.id],
      name: "workflow_versions_workspace_id_workflow_id_workflows_fk",
    }),
    check("workflow_versions_version_positive", sql`${table.version} > 0`),
  ],
);
