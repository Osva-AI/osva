import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { GenerateCompletionResult, ModelUsage } from "@osva-ai/contracts";

import { batchInferenceJobs } from "./batch-inference-jobs.js";

export const batchInferenceItems = pgTable(
  "batch_inference_items",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => batchInferenceJobs.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    providerCorrelationId: text("provider_correlation_id").notNull(),
    status: text("status").notNull(),
    inputJson: jsonb("input_json").notNull(),
    resultJson: jsonb("result_json").$type<GenerateCompletionResult>(),
    usageJson: jsonb("usage_json").$type<ModelUsage>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    providerRequestId: text("provider_request_id"),
    estimatedCostMicros: integer("estimated_cost_micros"),
    resultArtifactId: text("result_artifact_id"),
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
    uniqueIndex("batch_inference_items_job_correlation_uq").on(
      table.jobId,
      table.providerCorrelationId,
    ),
    index("batch_inference_items_job_id_status_idx").on(
      table.jobId,
      table.status,
    ),
    index("batch_inference_items_workspace_id_idx").on(table.workspaceId),
  ],
);
