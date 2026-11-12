import { integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { goals } from "./goals.js";
import { teams } from "./teams.js";
import { workspaces } from "./workspaces.js";

export const officeThreads = pgTable(
  "office_threads",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    title: text("title").notNull(),
    type: text("type").notNull(),
    teamId: text("team_id").references(() => teams.id),
    goalId: text("goal_id").references(() => goals.id),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    latestMessageSequence: integer("latest_message_sequence")
      .notNull()
      .default(0),
  },
  (table) => [
    unique("office_threads_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
  ],
);
