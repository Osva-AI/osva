import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { inferenceBudgetPolicyVersions } from "./inference-budget-policy-versions.js";
import { workspaces } from "./workspaces.js";

export const workspaceInferenceBudgetActivation = pgTable(
  "workspace_inference_budget_activation",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    activePolicyVersionId: text("active_policy_version_id").references(
      () => inferenceBudgetPolicyVersions.id,
      { onDelete: "set null" },
    ),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
);
