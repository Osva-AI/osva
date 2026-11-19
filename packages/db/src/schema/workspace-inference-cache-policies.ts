import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { sqlTextInList } from "./sql.js";
import { workspaces } from "./workspaces.js";

const PERSISTED_INFERENCE_CACHE_DETERMINISM = [
  "PROVIDER_DEFAULT",
  "REQUIRED_DETERMINISTIC",
] as const;

export const workspaceInferenceCachePolicies = pgTable(
  "workspace_inference_cache_policies",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    schemaVersion: text("schema_version").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    determinism: text("determinism").notNull(),
    ttlSeconds: integer("ttl_seconds"),
    maxEntryBytes: integer("max_entry_bytes"),
    allowEvaluationJudgeCache: boolean("allow_evaluation_judge_cache")
      .notNull()
      .default(false),
    allowToolDefinitions: boolean("allow_tool_definitions")
      .notNull()
      .default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    check(
      "workspace_inference_cache_policies_determinism_check",
      sql`${table.determinism} in (${sqlTextInList(PERSISTED_INFERENCE_CACHE_DETERMINISM)})`,
    ),
  ],
);
