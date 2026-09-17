import {
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { agents } from "./agents.js";
import { workspaces } from "./workspaces.js";

export const officeWorkers = pgTable(
  "office_workers",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    agentId: text("agent_id").notNull(),
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
    unique("office_workers_workspace_id_key_unique").on(
      table.workspaceId,
      table.key,
    ),
    unique("office_workers_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    foreignKey({
      columns: [table.workspaceId, table.agentId],
      foreignColumns: [agents.workspaceId, agents.id],
      name: "office_workers_workspace_id_agent_id_agents_fk",
    }),
  ],
);
