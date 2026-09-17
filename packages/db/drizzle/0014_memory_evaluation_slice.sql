CREATE TABLE "memory_namespaces" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "memory_namespaces_workspace_id_key_unique" UNIQUE("workspace_id","key"),
	CONSTRAINT "memory_namespaces_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "memory_namespaces" ADD CONSTRAINT "memory_namespaces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "memory_records" (
	"namespace_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "memory_records_pkey" PRIMARY KEY("namespace_id","key"),
	CONSTRAINT "memory_records_revision_positive" CHECK ("revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "memory_records" ADD CONSTRAINT "memory_records_namespace_id_memory_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."memory_namespaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "evaluation_suites" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evaluation_suites_workspace_id_key_unique" UNIQUE("workspace_id","key"),
	CONSTRAINT "evaluation_suites_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "evaluation_suites" ADD CONSTRAINT "evaluation_suites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "evaluation_suite_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_suite_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evaluation_suite_versions_suite_id_version_unique" UNIQUE("evaluation_suite_id","version"),
	CONSTRAINT "evaluation_suite_versions_suite_id_id_unique" UNIQUE("evaluation_suite_id","id"),
	CONSTRAINT "evaluation_suite_versions_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
ALTER TABLE "evaluation_suite_versions" ADD CONSTRAINT "evaluation_suite_versions_evaluation_suite_id_evaluation_suites_id_fk" FOREIGN KEY ("evaluation_suite_id") REFERENCES "public"."evaluation_suites"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_suite_versions" ADD CONSTRAINT "evaluation_suite_versions_workspace_id_suite_id_fk" FOREIGN KEY ("workspace_id","evaluation_suite_id") REFERENCES "public"."evaluation_suites"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "evaluation_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_suite_version_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text,
	"input" jsonb NOT NULL,
	"expected" jsonb,
	"evaluator" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evaluation_cases_version_id_key_unique" UNIQUE("evaluation_suite_version_id","key"),
	CONSTRAINT "evaluation_cases_version_id_id_unique" UNIQUE("evaluation_suite_version_id","id")
);
--> statement-breakpoint
ALTER TABLE "evaluation_cases" ADD CONSTRAINT "evaluation_cases_evaluation_suite_version_id_evaluation_suite_versions_id_fk" FOREIGN KEY ("evaluation_suite_version_id") REFERENCES "public"."evaluation_suite_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"evaluation_suite_version_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_version_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evaluation_runs_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "evaluation_runs_status_check" CHECK ("status" in ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED')),
	CONSTRAINT "evaluation_runs_target_type_check" CHECK ("target_type" in ('AGENT_VERSION','WORKFLOW_VERSION'))
);
--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_evaluation_suite_version_id_evaluation_suite_versions_id_fk" FOREIGN KEY ("evaluation_suite_version_id") REFERENCES "public"."evaluation_suite_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "evaluation_runs_status_created_at_id_idx" ON "evaluation_runs" USING btree ("status","created_at","id");
--> statement-breakpoint
CREATE TABLE "evaluation_case_results" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluation_run_id" text NOT NULL,
	"evaluation_case_id" text NOT NULL,
	"run_id" text NOT NULL,
	"outcome" text NOT NULL,
	"evaluator_results" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "evaluation_case_results_run_id_case_id_unique" UNIQUE("evaluation_run_id","evaluation_case_id"),
	CONSTRAINT "evaluation_case_results_outcome_check" CHECK ("outcome" in ('PASS','FAIL','ERROR'))
);
--> statement-breakpoint
ALTER TABLE "evaluation_case_results" ADD CONSTRAINT "evaluation_case_results_evaluation_run_id_evaluation_runs_id_fk" FOREIGN KEY ("evaluation_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_case_results" ADD CONSTRAINT "evaluation_case_results_evaluation_case_id_evaluation_cases_id_fk" FOREIGN KEY ("evaluation_case_id") REFERENCES "public"."evaluation_cases"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_case_results" ADD CONSTRAINT "evaluation_case_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "memory_namespace_bindings" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "evaluation_run_id" text;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "evaluation_case_id" text;
