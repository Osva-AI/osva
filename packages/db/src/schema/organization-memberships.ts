import { check, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organizations } from "./organizations.js";
import { sqlTextInList } from "./sql.js";
import { PERSISTED_ORGANIZATION_MEMBERSHIP_ROLES } from "./states.js";
import { users } from "./users.js";

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
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
    unique("organization_memberships_org_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    check(
      "organization_memberships_role_check",
      sql`${table.role} in (${sqlTextInList(PERSISTED_ORGANIZATION_MEMBERSHIP_ROLES)})`,
    ),
  ],
);
