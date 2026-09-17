import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { workspaces } from "./workspaces.js";

export const workflows = pgTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
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
    unique("workflows_workspace_id_key_unique").on(
      table.workspaceId,
      table.key,
    ),
    unique("workflows_workspace_id_id_unique").on(table.workspaceId, table.id),
  ],
);
