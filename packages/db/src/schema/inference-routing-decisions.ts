import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { inferenceRoutingPolicyVersions } from "./inference-routing-policy-versions.js";
import { workspaces } from "./workspaces.js";

export const inferenceRoutingDecisions = pgTable(
  "inference_routing_decisions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    policyVersionId: text("policy_version_id")
      .notNull()
      .references(() => inferenceRoutingPolicyVersions.id, {
        onDelete: "cascade",
      }),
    decisionJson: jsonb("decision_json").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    index("inference_routing_decisions_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);
