import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { workspaces } from "./workspaces.js";

export const inferenceModelInvocationSlots = pgTable(
  "inference_model_invocation_slots",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runAttemptId: text("run_attempt_id").notNull(),
    bindingName: text("binding_name").notNull(),
    logicalOperationKey: text("logical_operation_key").notNull(),
    modelInvocationOrdinal: integer("model_invocation_ordinal").notNull(),
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
    unique("inference_model_invocation_slots_workspace_key_unique").on(
      table.workspaceId,
      table.runAttemptId,
      table.bindingName,
      table.logicalOperationKey,
    ),
    index("inference_model_invocation_slots_attempt_idx").on(
      table.runAttemptId,
      table.bindingName,
    ),
    check(
      "inference_model_invocation_slots_ordinal_check",
      sql`${table.modelInvocationOrdinal} >= 1`,
    ),
  ],
);
