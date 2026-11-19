import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { inferenceRoutingPolicies } from "./inference-routing-policies.js";
import { workspaces } from "./workspaces.js";

export const inferenceRoutingPolicyVersions = pgTable(
  "inference_routing_policy_versions",
  {
    id: text("id").primaryKey(),
    policyId: text("policy_id")
      .notNull()
      .references(() => inferenceRoutingPolicies.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definitionJson: jsonb("definition_json").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("inference_routing_policy_versions_policy_version_unique").on(
      table.policyId,
      table.version,
    ),
    index("inference_routing_policy_versions_workspace_id_idx").on(
      table.workspaceId,
    ),
  ],
);
