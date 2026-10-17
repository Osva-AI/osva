import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { sqlTextInList } from "./sql.js";
import { PERSISTED_USER_STATUSES } from "./states.js";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    image: text("image"),
    status: text("status").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "users_status_check",
      sql`${table.status} in (${sqlTextInList(PERSISTED_USER_STATUSES)})`,
    ),
    uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`),
  ],
);
