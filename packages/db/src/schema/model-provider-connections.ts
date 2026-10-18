import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { workspaces } from "./workspaces.js";

export const modelProviderConnections = pgTable(
  "model_provider_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
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
    unique("model_provider_connections_workspace_id_key_unique").on(
      table.workspaceId,
      table.key,
    ),
    unique("model_provider_connections_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
  ],
);
