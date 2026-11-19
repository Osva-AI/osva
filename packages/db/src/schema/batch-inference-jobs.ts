import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { workspaces } from "./workspaces.js";

export const batchInferenceJobs = pgTable(
  "batch_inference_jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    provider: text("provider").notNull(),
    providerBatchId: text("provider_batch_id"),
    providerJobStatus: text("provider_job_status"),
    modelProfileVersionId: text("model_profile_version_id").notNull(),
    providerConnectionVersionId: text(
      "provider_connection_version_id",
    ).notNull(),
    providerModelId: text("provider_model_id").notNull(),
    submissionFingerprint: text("submission_fingerprint").notNull(),
    reconciliationRequired: boolean("reconciliation_required")
      .notNull()
      .default(false),
    reconciliationNote: text("reconciliation_note"),
    submissionLeaseOwner: text("submission_lease_owner"),
    submissionLeaseExpiresAt: timestamp("submission_lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    reconcileAfterAt: timestamp("reconcile_after_at", {
      withTimezone: true,
      mode: "date",
    }),
    progressTotal: integer("progress_total").notNull(),
    progressPending: integer("progress_pending").notNull(),
    progressProcessing: integer("progress_processing").notNull(),
    progressSucceeded: integer("progress_succeeded").notNull(),
    progressFailed: integer("progress_failed").notNull(),
    progressCancelled: integer("progress_cancelled").notNull(),
    progressExpired: integer("progress_expired").notNull(),
    jobErrorCode: text("job_error_code"),
    jobErrorMessage: text("job_error_message"),
    inputArtifactId: text("input_artifact_id"),
    outputArtifactId: text("output_artifact_id"),
    pricingSnapshotId: text("pricing_snapshot_id"),
    requestMaterialHash: text("request_material_hash").notNull().default(""),
    pricingSnapshotJson: jsonb("pricing_snapshot_json"),
    estimatedCostMicros: integer("estimated_cost_micros"),
    usageFinalizedAt: timestamp("usage_finalized_at", {
      withTimezone: true,
      mode: "date",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
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
    index("batch_inference_jobs_workspace_id_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    index("batch_inference_jobs_reconcile_after_at_idx").on(
      table.reconcileAfterAt,
    ),
    index("batch_inference_jobs_provider_batch_id_idx").on(
      table.provider,
      table.providerBatchId,
    ),
    uniqueIndex("batch_inference_jobs_workspace_fingerprint_uq").on(
      table.workspaceId,
      table.submissionFingerprint,
    ),
  ],
);
