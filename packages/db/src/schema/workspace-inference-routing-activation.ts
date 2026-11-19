import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { inferenceRoutingPolicyVersions } from "./inference-routing-policy-versions.js";
import { workspaces } from "./workspaces.js";

export const workspaceInferenceRoutingActivation = pgTable(
  "workspace_inference_routing_activation",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    activePolicyVersionId: text("active_policy_version_id").references(
      () => inferenceRoutingPolicyVersions.id,
      { onDelete: "set null" },
    ),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
);
