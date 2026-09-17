import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { evaluationCases } from "./evaluation-cases.js";
import { evaluationRuns } from "./evaluation-runs.js";
import { runs } from "./runs.js";
import { sqlTextInList } from "./sql.js";
import { PERSISTED_EVALUATION_CASE_OUTCOMES } from "./states.js";

export const evaluationCaseResults = pgTable(
  "evaluation_case_results",
  {
    id: text("id").primaryKey(),
    evaluationRunId: text("evaluation_run_id").notNull(),
    evaluationCaseId: text("evaluation_case_id").notNull(),
    runId: text("run_id").notNull(),
    outcome: text("outcome").notNull(),
    evaluatorResults: jsonb("evaluator_results")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    unique("evaluation_case_results_run_id_case_id_unique").on(
      table.evaluationRunId,
      table.evaluationCaseId,
    ),
    foreignKey({
      columns: [table.evaluationRunId],
      foreignColumns: [evaluationRuns.id],
      name: "evaluation_case_results_evaluation_run_id_fk",
    }),
    foreignKey({
      columns: [table.evaluationCaseId],
      foreignColumns: [evaluationCases.id],
      name: "evaluation_case_results_evaluation_case_id_fk",
    }),
    foreignKey({
      columns: [table.runId],
      foreignColumns: [runs.id],
      name: "evaluation_case_results_run_id_fk",
    }),
    check(
      "evaluation_case_results_outcome_check",
      sql`${table.outcome} in (${sqlTextInList(PERSISTED_EVALUATION_CASE_OUTCOMES)})`,
    ),
  ],
);
