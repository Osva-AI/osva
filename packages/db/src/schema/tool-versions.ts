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
import type { McpToolVersionConfig } from "@osva/contracts";

import { sqlTextInList } from "./sql.js";
import { PERSISTED_TOOL_TYPES } from "./states.js";
import { tools } from "./tools.js";

export const toolVersions = pgTable(
  "tool_versions",
  {
    id: text("id").primaryKey(),
    toolId: text("tool_id")
      .notNull()
      .references(() => tools.id),
    version: integer("version").notNull(),
    type: text("type").notNull(),
    implementation: text("implementation").notNull(),
    mcpConfig: jsonb("mcp_config").$type<McpToolVersionConfig>(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("tool_versions_tool_id_version_unique").on(
      table.toolId,
      table.version,
    ),
    unique("tool_versions_tool_id_id_unique").on(table.toolId, table.id),
    check("tool_versions_version_positive", sql`${table.version} > 0`),
    check(
      "tool_versions_type_check",
      sql`${table.type} in (${sqlTextInList(PERSISTED_TOOL_TYPES)})`,
    ),
  ],
);
