import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { inferenceBudgetPolicyVersions } from "./inference-budget-policy-versions.js";
import { inferenceInvocations } from "./inference-invocations.js";
import { PERSISTED_INFERENCE_BUDGET_RESERVATION_STATUSES } from "./states.js";
import { runSteps } from "./run-steps.js";
import { sqlTextInList } from "./sql.js";
import { workspaces } from "./workspaces.js";

export const inferenceBudgetReservations = pgTable(
  "inference_budget_reservations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    reservationKey: text("reservation_key").notNull(),
    inferenceInvocationId: text("inference_invocation_id")
      .notNull()
      .references(() => inferenceInvocations.id, { onDelete: "cascade" }),
    providerAttemptIndex: integer("provider_attempt_index").notNull(),
    selectedModelProfileVersionId: text(
      "selected_model_profile_version_id",
    ).notNull(),
    periodKey: text("period_key").notNull(),
    budgetPolicyVersionId: text("budget_policy_version_id")
      .notNull()
      .references(() => inferenceBudgetPolicyVersions.id, {
        onDelete: "restrict",
      }),
    pricingSnapshotId: text("pricing_snapshot_id").notNull(),
    status: text("status").notNull(),
    reservedUsdMicros: bigint("reserved_usd_micros", {
      mode: "number",
    }).notNull(),
    committedUsdMicros: bigint("committed_usd_micros", { mode: "number" }),
    uncertainFloorUsdMicros: bigint("uncertain_floor_usd_micros", {
      mode: "number",
    }),
    providerRequestId: text("provider_request_id"),
    admittedExecutionGeneration: integer("admitted_execution_generation"),
    providerStartedAt: timestamp("provider_started_at", {
      withTimezone: true,
      mode: "date",
    }),
    runStepId: text("run_step_id").references(() => runSteps.id, {
      onDelete: "set null",
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
    unique("inference_budget_reservations_workspace_key_unique").on(
      table.workspaceId,
      table.reservationKey,
    ),
    index("inference_budget_reservations_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    index("inference_budget_reservations_invocation_idx").on(
      table.inferenceInvocationId,
    ),
    check(
      "inference_budget_reservations_status_check",
      sql`${table.status} in (${sqlTextInList(PERSISTED_INFERENCE_BUDGET_RESERVATION_STATUSES)})`,
    ),
    check(
      "inference_budget_reservations_reserved_nonneg_check",
      sql`${table.reservedUsdMicros} >= 0`,
    ),
    check(
      "inference_budget_reservations_provider_attempt_index_check",
      sql`${table.providerAttemptIndex} >= 0`,
    ),
  ],
);
