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

import { runs } from "./runs.js";
import { sqlTextInList } from "./sql.js";
import { PERSISTED_RUN_ATTEMPT_STATES } from "./states.js";

export const runAttempts = pgTable(
  "run_attempts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    sequence: integer("sequence").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    error: jsonb("error").$type<{ code: string; message: string }>(),
    output: jsonb("output"),
    infrastructureMetadata: jsonb("infrastructure_metadata").$type<
      Readonly<Record<string, unknown>>
    >(),
    executionOwner: text("execution_owner"),
    executionGeneration: integer("execution_generation").notNull().default(0),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    foreignKey({
      columns: [table.runId],
      foreignColumns: [runs.id],
      name: "run_attempts_run_id_runs_id_fk",
    }),
    unique("run_attempts_run_id_id_unique").on(table.runId, table.id),
    unique("run_attempts_run_id_sequence_unique").on(
      table.runId,
      table.sequence,
    ),
    check("run_attempts_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "run_attempts_status_check",
      sql`${table.status} in (${sqlTextInList(PERSISTED_RUN_ATTEMPT_STATES)})`,
    ),
    index("run_attempts_expired_lease_idx")
      .on(table.leaseExpiresAt)
      .where(
        sql`${table.status} = 'RUNNING' AND ${table.executionOwner} IS NOT NULL`,
      ),
  ],
);
