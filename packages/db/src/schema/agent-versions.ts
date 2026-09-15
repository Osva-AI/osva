import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { agents } from "./agents.js";

export const agentVersions = pgTable(
  "agent_versions",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    version: integer("version").notNull(),
    manifest: jsonb("manifest")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("agent_versions_agent_id_version_unique").on(
      table.agentId,
      table.version,
    ),
    unique("agent_versions_agent_id_id_unique").on(table.agentId, table.id),
    check("agent_versions_version_positive", sql`${table.version} > 0`),
  ],
);
