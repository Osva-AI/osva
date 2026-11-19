import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { workspaces } from "./workspaces.js";

export const inferenceRoutingPolicies = pgTable(
  "inference_routing_policies",
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
    unique("inference_routing_policies_workspace_key_unique").on(
      table.workspaceId,
      table.key,
    ),
    index("inference_routing_policies_workspace_id_idx").on(table.workspaceId),
  ],
);
