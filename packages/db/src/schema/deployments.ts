import { foreignKey, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { agentVersions } from "./agent-versions.js";
import { agents } from "./agents.js";

export const deployments = pgTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    agentVersionId: text("agent_version_id").notNull(),
    environment: text("environment").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.agentId],
      foreignColumns: [agents.workspaceId, agents.id],
      name: "deployments_workspace_id_agent_id_agents_fk",
    }),
    foreignKey({
      columns: [table.agentId, table.agentVersionId],
      foreignColumns: [agentVersions.agentId, agentVersions.id],
      name: "deployments_agent_id_agent_version_id_agent_versions_fk",
    }),
  ],
);
