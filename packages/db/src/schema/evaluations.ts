import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { runAttempts } from "./run-attempts.js";
import { sqlTextInList } from "./sql.js";
import { PERSISTED_EVALUATOR_TYPES } from "./states.js";

export const evaluations = pgTable(
  "evaluations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    runAttemptId: text("run_attempt_id").notNull(),
    evaluatorType: text("evaluator_type").notNull(),
    expected: jsonb("expected").notNull(),
    passed: boolean("passed").notNull(),
    score: doublePrecision("score").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.runId, table.runAttemptId],
      foreignColumns: [runAttempts.runId, runAttempts.id],
      name: "evaluations_run_attempt_same_run_fk",
    }),
    index("evaluations_run_attempt_created_at_id_idx").on(
      table.runAttemptId,
      table.createdAt,
      table.id,
    ),
    check(
      "evaluations_evaluator_type_check",
      sql`${table.evaluatorType} in (${sqlTextInList(PERSISTED_EVALUATOR_TYPES)})`,
    ),
  ],
);
