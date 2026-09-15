import {
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { runAttempts } from "./run-attempts.js";

export const runSteps = pgTable(
  "run_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    runAttemptId: text("run_attempt_id").notNull(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    metadata: jsonb("metadata").$type<Readonly<Record<string, unknown>>>(),
  },
  (table) => [
    foreignKey({
      columns: [table.runId, table.runAttemptId],
      foreignColumns: [runAttempts.runId, runAttempts.id],
      name: "run_steps_run_attempt_same_run_fk",
    }),
  ],
);
