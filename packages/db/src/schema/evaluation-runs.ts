import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { evaluationSuiteVersions } from "./evaluation-suite-versions.js";
import { sqlTextInList } from "./sql.js";
import {
  PERSISTED_EVALUATION_RUN_STATES,
  PERSISTED_EVALUATION_RUN_TARGET_TYPES,
} from "./states.js";

export const evaluationRuns = pgTable(
  "evaluation_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    evaluationSuiteVersionId: text("evaluation_suite_version_id").notNull(),
    targetType: text("target_type").notNull(),
    targetVersionId: text("target_version_id").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("evaluation_runs_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    foreignKey({
      columns: [table.evaluationSuiteVersionId],
      foreignColumns: [evaluationSuiteVersions.id],
      name: "evaluation_runs_evaluation_suite_version_id_fk",
    }),
    index("evaluation_runs_status_created_at_id_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
    check(
      "evaluation_runs_status_check",
      sql`${table.status} in (${sqlTextInList(PERSISTED_EVALUATION_RUN_STATES)})`,
    ),
    check(
      "evaluation_runs_target_type_check",
      sql`${table.targetType} in (${sqlTextInList(PERSISTED_EVALUATION_RUN_TARGET_TYPES)})`,
    ),
  ],
);
