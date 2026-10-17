import { check, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { sqlTextInList } from "./sql.js";
import { PERSISTED_HUMAN_WORKSPACE_ROLES } from "./states.js";
import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("workspace_memberships_workspace_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
    check(
      "workspace_memberships_role_check",
      sql`${table.role} in (${sqlTextInList(PERSISTED_HUMAN_WORKSPACE_ROLES)})`,
    ),
  ],
);
