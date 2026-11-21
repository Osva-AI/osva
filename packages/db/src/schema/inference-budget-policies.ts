import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { workspaces } from "./workspaces.js";

export const inferenceBudgetPolicies = pgTable(
  "workspace_inference_budget_policies",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("workspace_inference_budget_policies_workspace_key_unique").on(
      table.workspaceId,
      table.key,
    ),
    index("workspace_inference_budget_policies_workspace_id_idx").on(
      table.workspaceId,
    ),
  ],
);
