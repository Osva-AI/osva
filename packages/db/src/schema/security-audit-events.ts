import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organizations } from "./organizations.js";
import { users } from "./users.js";
import { workspaces } from "./workspaces.js";

export const securityAuditEvents = pgTable("security_audit_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  organizationId: text("organization_id").references(() => organizations.id),
  workspaceId: text("workspace_id").references(() => workspaces.id),
  actorUserId: text("actor_user_id").references(() => users.id),
  details: jsonb("details").notNull().default({}),
});
