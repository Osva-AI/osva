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
import { PERSISTED_INFERENCE_BUDGET_PERIOD_KINDS } from "./states.js";
import { sqlTextInList } from "./sql.js";
import { workspaces } from "./workspaces.js";

export const workspaceInferenceBudgetPeriods = pgTable(
  "workspace_inference_budget_periods",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    periodKind: text("period_kind").notNull(),
    periodKey: text("period_key").notNull(),
    periodStartUtc: timestamp("period_start_utc", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    periodEndExclusiveUtc: timestamp("period_end_exclusive_utc", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    budgetPolicyVersionId: text("budget_policy_version_id")
      .notNull()
      .references(() => inferenceBudgetPolicyVersions.id, {
        onDelete: "restrict",
      }),
    limitUsdMicros: bigint("limit_usd_micros", { mode: "number" }).notNull(),
    committedLiabilityUsdMicros: bigint("committed_liability_usd_micros", {
      mode: "number",
    })
      .notNull()
      .default(0),
    heldReservationsUsdMicros: bigint("held_reservations_usd_micros", {
      mode: "number",
    })
      .notNull()
      .default(0),
    unresolvedUncertainLiabilityUsdMicros: bigint(
      "unresolved_uncertain_liability_usd_micros",
      { mode: "number" },
    )
      .notNull()
      .default(0),
    overageUsdMicros: bigint("overage_usd_micros", { mode: "number" })
      .notNull()
      .default(0),
    schemaVersion: integer("schema_version").notNull().default(1),
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
    unique("workspace_inference_budget_periods_workspace_period_unique").on(
      table.workspaceId,
      table.periodKey,
    ),
    index("workspace_inference_budget_periods_workspace_id_idx").on(
      table.workspaceId,
    ),
    check(
      "workspace_inference_budget_periods_period_kind_check",
      sql`${table.periodKind} in (${sqlTextInList(PERSISTED_INFERENCE_BUDGET_PERIOD_KINDS)})`,
    ),
    check(
      "workspace_inference_budget_periods_limit_nonneg_check",
      sql`${table.limitUsdMicros} >= 0`,
    ),
    check(
      "workspace_inference_budget_periods_committed_nonneg_check",
      sql`${table.committedLiabilityUsdMicros} >= 0`,
    ),
    check(
      "workspace_inference_budget_periods_held_nonneg_check",
      sql`${table.heldReservationsUsdMicros} >= 0`,
    ),
    check(
      "workspace_inference_budget_periods_uncertain_nonneg_check",
      sql`${table.unresolvedUncertainLiabilityUsdMicros} >= 0`,
    ),
    check(
      "workspace_inference_budget_periods_overage_nonneg_check",
      sql`${table.overageUsdMicros} >= 0`,
    ),
  ],
);
