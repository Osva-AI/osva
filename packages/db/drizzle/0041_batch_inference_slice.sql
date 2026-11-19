CREATE TABLE "workspace_batch_inference_policies" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"schema_version" text NOT NULL,
	"batch_inference_enabled" boolean DEFAULT false NOT NULL,
	"deny_sensitive_workloads" boolean DEFAULT true NOT NULL,
	"max_item_count" integer,
	"allowed_providers" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_batch_inference_policies" ADD CONSTRAINT "workspace_batch_inference_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "batch_inference_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"provider_batch_id" text,
	"provider_job_status" text,
	"model_profile_version_id" text NOT NULL,
	"provider_connection_version_id" text NOT NULL,
	"provider_model_id" text NOT NULL,
	"submission_fingerprint" text NOT NULL,
	"reconciliation_required" boolean DEFAULT false NOT NULL,
	"reconciliation_note" text,
	"submission_lease_owner" text,
	"submission_lease_expires_at" timestamp with time zone,
	"reconcile_after_at" timestamp with time zone,
	"progress_total" integer NOT NULL,
	"progress_pending" integer NOT NULL,
	"progress_processing" integer NOT NULL,
	"progress_succeeded" integer NOT NULL,
	"progress_failed" integer NOT NULL,
	"progress_cancelled" integer NOT NULL,
	"progress_expired" integer NOT NULL,
	"job_error_code" text,
	"job_error_message" text,
	"input_artifact_id" text,
	"output_artifact_id" text,
	"pricing_snapshot_id" text,
	"estimated_cost_micros" integer,
	"usage_finalized_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batch_inference_jobs" ADD CONSTRAINT "batch_inference_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "batch_inference_jobs_workspace_fingerprint_uq" ON "batch_inference_jobs" USING btree ("workspace_id","submission_fingerprint");
--> statement-breakpoint
CREATE INDEX "batch_inference_jobs_workspace_id_status_idx" ON "batch_inference_jobs" USING btree ("workspace_id","status");
--> statement-breakpoint
CREATE INDEX "batch_inference_jobs_reconcile_after_at_idx" ON "batch_inference_jobs" USING btree ("reconcile_after_at");
--> statement-breakpoint
CREATE INDEX "batch_inference_jobs_provider_batch_id_idx" ON "batch_inference_jobs" USING btree ("provider","provider_batch_id");
--> statement-breakpoint
CREATE TABLE "batch_inference_items" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"provider_correlation_id" text NOT NULL,
	"status" text NOT NULL,
	"input_json" jsonb NOT NULL,
	"result_json" jsonb,
	"usage_json" jsonb,
	"error_code" text,
	"error_message" text,
	"provider_request_id" text,
	"estimated_cost_micros" integer,
	"result_artifact_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batch_inference_items" ADD CONSTRAINT "batch_inference_items_job_id_batch_inference_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."batch_inference_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "batch_inference_items_job_correlation_uq" ON "batch_inference_items" USING btree ("job_id","provider_correlation_id");
--> statement-breakpoint
CREATE INDEX "batch_inference_items_job_id_status_idx" ON "batch_inference_items" USING btree ("job_id","status");
--> statement-breakpoint
CREATE INDEX "batch_inference_items_workspace_id_idx" ON "batch_inference_items" USING btree ("workspace_id");