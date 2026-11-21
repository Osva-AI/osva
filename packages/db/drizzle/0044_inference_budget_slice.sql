CREATE TABLE "workspace_inference_budget_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_inference_budget_policies_workspace_key_unique" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE "workspace_inference_budget_policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"definition_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_inference_budget_policy_versions_policy_version_unique" UNIQUE("policy_id","version")
);
--> statement-breakpoint
CREATE TABLE "workspace_inference_budget_activation" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"active_policy_version_id" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_inference_budget_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"period_kind" text NOT NULL,
	"period_key" text NOT NULL,
	"period_start_utc" timestamp with time zone NOT NULL,
	"period_end_exclusive_utc" timestamp with time zone NOT NULL,
	"budget_policy_version_id" text NOT NULL,
	"limit_usd_micros" bigint NOT NULL,
	"committed_liability_usd_micros" bigint DEFAULT 0 NOT NULL,
	"held_reservations_usd_micros" bigint DEFAULT 0 NOT NULL,
	"unresolved_uncertain_liability_usd_micros" bigint DEFAULT 0 NOT NULL,
	"overage_usd_micros" bigint DEFAULT 0 NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_inference_budget_periods_workspace_period_unique" UNIQUE("workspace_id","period_key"),
	CONSTRAINT "workspace_inference_budget_periods_period_kind_check" CHECK ("period_kind" in ('CALENDAR_MONTH_UTC')),
	CONSTRAINT "workspace_inference_budget_periods_limit_nonneg_check" CHECK ("limit_usd_micros" >= 0),
	CONSTRAINT "workspace_inference_budget_periods_committed_nonneg_check" CHECK ("committed_liability_usd_micros" >= 0),
	CONSTRAINT "workspace_inference_budget_periods_held_nonneg_check" CHECK ("held_reservations_usd_micros" >= 0),
	CONSTRAINT "workspace_inference_budget_periods_uncertain_nonneg_check" CHECK ("unresolved_uncertain_liability_usd_micros" >= 0),
	CONSTRAINT "workspace_inference_budget_periods_overage_nonneg_check" CHECK ("overage_usd_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inference_invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"invocation_anchor" text NOT NULL,
	"anchor_json" jsonb NOT NULL,
	"invocation_kind" text NOT NULL,
	"period_key" text NOT NULL,
	"budget_policy_version_id" text NOT NULL,
	"pricing_snapshot_id" text NOT NULL,
	"run_id" text,
	"run_attempt_id" text,
	"run_step_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inference_invocations_workspace_anchor_unique" UNIQUE("workspace_id","invocation_anchor"),
	CONSTRAINT "inference_invocations_kind_check" CHECK ("invocation_kind" in ('SYNC','STREAM','JUDGE','BATCH'))
);
--> statement-breakpoint
CREATE TABLE "inference_budget_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"reservation_key" text NOT NULL,
	"inference_invocation_id" text NOT NULL,
	"provider_attempt_index" integer NOT NULL,
	"selected_model_profile_version_id" text NOT NULL,
	"period_key" text NOT NULL,
	"budget_policy_version_id" text NOT NULL,
	"pricing_snapshot_id" text NOT NULL,
	"status" text NOT NULL,
	"reserved_usd_micros" bigint NOT NULL,
	"committed_usd_micros" bigint,
	"uncertain_floor_usd_micros" bigint,
	"provider_request_id" text,
	"run_step_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inference_budget_reservations_workspace_key_unique" UNIQUE("workspace_id","reservation_key"),
	CONSTRAINT "inference_budget_reservations_status_check" CHECK ("status" in ('ADMITTED','PROVIDER_STARTED','COMMITTED','RELEASED','RECONCILIATION_REQUIRED','EXPIRED')),
	CONSTRAINT "inference_budget_reservations_reserved_nonneg_check" CHECK ("reserved_usd_micros" >= 0),
	CONSTRAINT "inference_budget_reservations_provider_attempt_index_check" CHECK ("provider_attempt_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "workspace_inference_budget_policies" ADD CONSTRAINT "workspace_inference_budget_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_inference_budget_policy_versions" ADD CONSTRAINT "workspace_inference_budget_policy_versions_policy_id_workspace_inference_budget_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."workspace_inference_budget_policies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_inference_budget_policy_versions" ADD CONSTRAINT "workspace_inference_budget_policy_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_inference_budget_activation" ADD CONSTRAINT "workspace_inference_budget_activation_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_inference_budget_activation" ADD CONSTRAINT "workspace_inference_budget_activation_active_policy_version_id_workspace_inference_budget_policy_versions_id_fk" FOREIGN KEY ("active_policy_version_id") REFERENCES "public"."workspace_inference_budget_policy_versions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_inference_budget_periods" ADD CONSTRAINT "workspace_inference_budget_periods_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_inference_budget_periods" ADD CONSTRAINT "workspace_inference_budget_periods_budget_policy_version_id_workspace_inference_budget_policy_versions_id_fk" FOREIGN KEY ("budget_policy_version_id") REFERENCES "public"."workspace_inference_budget_policy_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inference_invocations" ADD CONSTRAINT "inference_invocations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inference_invocations" ADD CONSTRAINT "inference_invocations_budget_policy_version_id_workspace_inference_budget_policy_versions_id_fk" FOREIGN KEY ("budget_policy_version_id") REFERENCES "public"."workspace_inference_budget_policy_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inference_invocations" ADD CONSTRAINT "inference_invocations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inference_invocations" ADD CONSTRAINT "inference_invocations_run_step_id_run_steps_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_steps"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inference_budget_reservations" ADD CONSTRAINT "inference_budget_reservations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inference_budget_reservations" ADD CONSTRAINT "inference_budget_reservations_inference_invocation_id_inference_invocations_id_fk" FOREIGN KEY ("inference_invocation_id") REFERENCES "public"."inference_invocations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inference_budget_reservations" ADD CONSTRAINT "inference_budget_reservations_budget_policy_version_id_workspace_inference_budget_policy_versions_id_fk" FOREIGN KEY ("budget_policy_version_id") REFERENCES "public"."workspace_inference_budget_policy_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inference_budget_reservations" ADD CONSTRAINT "inference_budget_reservations_run_step_id_run_steps_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_steps"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workspace_inference_budget_policies_workspace_id_idx" ON "workspace_inference_budget_policies" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "workspace_inference_budget_policy_versions_workspace_id_idx" ON "workspace_inference_budget_policy_versions" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "workspace_inference_budget_periods_workspace_id_idx" ON "workspace_inference_budget_periods" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "inference_invocations_workspace_id_idx" ON "inference_invocations" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "inference_budget_reservations_workspace_status_idx" ON "inference_budget_reservations" USING btree ("workspace_id","status");
--> statement-breakpoint
CREATE INDEX "inference_budget_reservations_invocation_idx" ON "inference_budget_reservations" USING btree ("inference_invocation_id");