import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { evaluationCases } from "./evaluation-cases.js";
import { evaluationRuns } from "./evaluation-runs.js";
import { runs } from "./runs.js";
import { runAttempts } from "./run-attempts.js";
import { sqlTextInList } from "./sql.js";

export const PERSISTED_EVALUATION_JUDGE_TASK_STATES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
] as const;

export const evaluationJudgeTasks = pgTable(
  "evaluation_judge_tasks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    evaluationRunId: text("evaluation_run_id").notNull(),
    evaluationCaseId: text("evaluation_case_id").notNull(),
    runId: text("run_id").notNull(),
    runAttemptId: text("run_attempt_id").notNull(),
    snapshot: jsonb("snapshot")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    executionOwner: text("execution_owner"),
    executionGeneration: integer("execution_generation").notNull().default(0),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    terminalResult:
      jsonb("terminal_result").$type<Readonly<Record<string, unknown>>>(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    unique("evaluation_judge_tasks_run_case_unique").on(
      table.evaluationRunId,
      table.evaluationCaseId,
    ),
    foreignKey({
      columns: [table.evaluationRunId],
      foreignColumns: [evaluationRuns.id],
      name: "evaluation_judge_tasks_evaluation_run_id_fk",
    }),
    foreignKey({
      columns: [table.evaluationCaseId],
      foreignColumns: [evaluationCases.id],
      name: "evaluation_judge_tasks_evaluation_case_id_fk",
    }),
    foreignKey({
      columns: [table.runId],
      foreignColumns: [runs.id],
      name: "evaluation_judge_tasks_run_id_fk",
    }),
    foreignKey({
      columns: [table.runAttemptId],
      foreignColumns: [runAttempts.id],
      name: "evaluation_judge_tasks_run_attempt_id_fk",
    }),
    check(
      "evaluation_judge_tasks_status_check",
      sql`${table.status} in (${sqlTextInList(PERSISTED_EVALUATION_JUDGE_TASK_STATES)})`,
    ),
    check(
      "evaluation_judge_tasks_attempt_count_positive",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "evaluation_judge_tasks_max_attempts_positive",
      sql`${table.maxAttempts} > 0`,
    ),
    index("evaluation_judge_tasks_recovery_idx").on(
      table.status,
      table.leaseExpiresAt,
      table.createdAt,
      table.id,
    ),
  ],
);
