import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { workspaces } from "./workspaces.js";

export const modelProfiles = pgTable(
  "model_profiles",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("model_profiles_workspace_id_key_unique").on(
      table.workspaceId,
      table.key,
    ),
    unique("model_profiles_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
  ],
);
