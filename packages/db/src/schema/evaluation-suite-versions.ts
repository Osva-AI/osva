import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { evaluationSuites } from "./evaluation-suites.js";

export const evaluationSuiteVersions = pgTable(
  "evaluation_suite_versions",
  {
    id: text("id").primaryKey(),
    evaluationSuiteId: text("evaluation_suite_id")
      .notNull()
      .references(() => evaluationSuites.id),
    workspaceId: text("workspace_id").notNull(),
    version: integer("version").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("evaluation_suite_versions_suite_id_version_unique").on(
      table.evaluationSuiteId,
      table.version,
    ),
    unique("evaluation_suite_versions_suite_id_id_unique").on(
      table.evaluationSuiteId,
      table.id,
    ),
    foreignKey({
      columns: [table.workspaceId, table.evaluationSuiteId],
      foreignColumns: [evaluationSuites.workspaceId, evaluationSuites.id],
      name: "evaluation_suite_versions_workspace_id_suite_id_fk",
    }),
    check(
      "evaluation_suite_versions_version_positive",
      sql`${table.version} > 0`,
    ),
  ],
);
