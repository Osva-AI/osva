import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organizations } from "./organizations.js";

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  organizationId: text("organization_id").references(() => organizations.id),
  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
});
