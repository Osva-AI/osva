import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { agentVersions } from "./agent-versions.js";
import { agents } from "./agents.js";

export const schedules = pgTable(
  "schedules",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    agentId: text("agent_id").notNull(),
    agentVersionId: text("agent_version_id").notNull(),
    cronExpression: text("cron_expression").notNull(),
    timezone: text("timezone").notNull(),
    input: jsonb("input").notNull(),
    enabled: boolean("enabled").notNull(),
    nextRunAt: timestamp("next_run_at", {
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
    uniqueIndex("schedules_workspace_id_key_unique").on(
      table.workspaceId,
      table.key,
    ),
    index("schedules_enabled_next_run_at_id_idx").on(
      table.enabled,
      table.nextRunAt,
      table.id,
    ),
    index("schedules_workspace_created_at_id_idx").on(
      table.workspaceId,
      table.createdAt,
      table.id,
    ),
    foreignKey({
      columns: [table.workspaceId, table.agentId],
      foreignColumns: [agents.workspaceId, agents.id],
      name: "schedules_workspace_id_agent_id_agents_fk",
    }),
    foreignKey({
      columns: [table.agentId, table.agentVersionId],
      foreignColumns: [agentVersions.agentId, agentVersions.id],
      name: "schedules_agent_id_agent_version_id_agent_versions_fk",
    }),
  ],
);
