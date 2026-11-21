import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { inferenceBudgetPolicyVersions } from "./inference-budget-policy-versions.js";
import { PERSISTED_INFERENCE_INVOCATION_KINDS } from "./states.js";
import { runs } from "./runs.js";
import { runSteps } from "./run-steps.js";
import { sqlTextInList } from "./sql.js";
import { workspaces } from "./workspaces.js";

export const inferenceInvocations = pgTable(
  "inference_invocations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    invocationAnchor: text("invocation_anchor").notNull(),
    anchorJson: jsonb("anchor_json").notNull(),
    invocationKind: text("invocation_kind").notNull(),
    periodKey: text("period_key").notNull(),
    budgetPolicyVersionId: text("budget_policy_version_id")
      .notNull()
      .references(() => inferenceBudgetPolicyVersions.id, {
        onDelete: "restrict",
      }),
    pricingSnapshotId: text("pricing_snapshot_id").notNull(),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
    runAttemptId: text("run_attempt_id"),
    runStepId: text("run_step_id").references(() => runSteps.id, {
      onDelete: "set null",
    }),
    executionGeneration: integer("execution_generation"),
    lastExecutionGeneration: integer("last_execution_generation"),
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
    unique("inference_invocations_workspace_anchor_unique").on(
      table.workspaceId,
      table.invocationAnchor,
    ),
    index("inference_invocations_workspace_id_idx").on(table.workspaceId),
    check(
      "inference_invocations_kind_check",
      sql`${table.invocationKind} in (${sqlTextInList(PERSISTED_INFERENCE_INVOCATION_KINDS)})`,
    ),
  ],
);
