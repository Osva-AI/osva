import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { PERSISTED_GOAL_STATES } from "./states.js";
import { workspaces } from "./workspaces.js";

export const goals = pgTable(
  "goals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: PERSISTED_GOAL_STATES }).notNull(),
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
    unique("goals_workspace_id_key_unique").on(table.workspaceId, table.key),
    unique("goals_workspace_id_id_unique").on(table.workspaceId, table.id),
  ],
);
