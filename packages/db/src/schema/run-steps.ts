import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { runAttempts } from "./run-attempts.js";
import { sqlTextInList } from "./sql.js";
import {
  PERSISTED_RUN_STEP_KINDS,
  PERSISTED_RUN_STEP_STATUSES,
} from "./states.js";

export const runSteps = pgTable(
  "run_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    runAttemptId: text("run_attempt_id").notNull(),
    kind: text("kind").notNull(),
    bindingName: text("binding_name").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    modelProfileVersionId: text("model_profile_version_id"),
    toolVersionId: text("tool_version_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    estimatedCostUsdMicros: bigint("estimated_cost_usd_micros", {
      mode: "number",
    }),
    errorCode: text("error_code"),
  },
  (table) => [
    foreignKey({
      columns: [table.runId, table.runAttemptId],
      foreignColumns: [runAttempts.runId, runAttempts.id],
      name: "run_steps_run_attempt_same_run_fk",
    }),
    index("run_steps_run_attempt_started_at_id_idx").on(
      table.runAttemptId,
      table.startedAt,
      table.id,
    ),
    check(
      "run_steps_kind_check",
      sql`${table.kind} in (${sqlTextInList(PERSISTED_RUN_STEP_KINDS)})`,
    ),
    check(
      "run_steps_status_check",
      sql`${table.status} in (${sqlTextInList(PERSISTED_RUN_STEP_STATUSES)})`,
    ),
  ],
);
