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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { JsonValue } from "@osva-ai/contracts";
import {
  RUN_OPERATION_IDEMPOTENCY_CLASSES,
  RUN_OPERATION_STATUSES,
} from "@osva-ai/contracts";

import { runAttempts } from "./run-attempts.js";
import { runs } from "./runs.js";
import { workspaces } from "./workspaces.js";
import { sqlTextInList } from "./sql.js";

export const runOperationJournal = pgTable(
  "run_operation_journal",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    runAttemptId: text("run_attempt_id").notNull(),
    executionGeneration: integer("execution_generation").notNull(),
    operationKey: text("operation_key").notNull(),
    toolVersionId: text("tool_version_id").notNull(),
    bindingName: text("binding_name").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    idempotencyClass: text("idempotency_class").notNull(),
    status: text("status").notNull(),
    committedResult: jsonb("committed_result").$type<JsonValue>(),
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
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "run_operation_journal_workspace_id_workspaces_id_fk",
    }),
    foreignKey({
      columns: [table.runId],
      foreignColumns: [runs.id],
      name: "run_operation_journal_run_id_runs_id_fk",
    }),
    foreignKey({
      columns: [table.runId, table.runAttemptId],
      foreignColumns: [runAttempts.runId, runAttempts.id],
      name: "run_operation_journal_run_attempt_fk",
    }),
    uniqueIndex("run_operation_journal_run_operation_key_unique").on(
      table.runId,
      table.operationKey,
    ),
    index("run_operation_journal_run_id_status_idx").on(
      table.runId,
      table.status,
    ),
    check(
      "run_operation_journal_status_check",
      sql`${table.status} in (${sqlTextInList(RUN_OPERATION_STATUSES)})`,
    ),
    check(
      "run_operation_journal_idempotency_class_check",
      sql`${table.idempotencyClass} in (${sqlTextInList(RUN_OPERATION_IDEMPOTENCY_CLASSES)})`,
    ),
  ],
);
