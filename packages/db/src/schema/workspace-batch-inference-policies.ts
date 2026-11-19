import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { workspaces } from "./workspaces.js";

export const workspaceBatchInferencePolicies = pgTable(
  "workspace_batch_inference_policies",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    schemaVersion: text("schema_version").notNull(),
    batchInferenceEnabled: boolean("batch_inference_enabled")
      .notNull()
      .default(false),
    denySensitiveWorkloads: boolean("deny_sensitive_workloads")
      .notNull()
      .default(true),
    maxItemCount: integer("max_item_count"),
    allowedProviders: text("allowed_providers"),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
);
