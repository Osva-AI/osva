CREATE TABLE "evaluation_comparisons" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"baseline_evaluation_run_id" text NOT NULL,
	"candidate_evaluation_run_id" text NOT NULL,
	"evaluation_suite_version_id" text NOT NULL,
	"status" text NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"pairwise_config" jsonb,
	"deterministic_summary" jsonb,
	"pairwise_summary" jsonb,
	"regression_assessment" jsonb,
	"promotion" jsonb,
	"cost_summary" jsonb,
	"pairwise_rubric_identity" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "evaluation_comparisons_distinct_runs" CHECK ("baseline_evaluation_run_id" <> "candidate_evaluation_run_id"),
	CONSTRAINT "evaluation_comparisons_status_check" CHECK ("status" in ('PENDING','RUNNING','COMPLETED','FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_comparisons_runs_unique" ON "evaluation_comparisons" ("baseline_evaluation_run_id","candidate_evaluation_run_id");
--> statement-breakpoint
CREATE INDEX "evaluation_comparisons_workspace_created_idx" ON "evaluation_comparisons" ("workspace_id","created_at","id");
--> statement-breakpoint
ALTER TABLE "evaluation_comparisons" ADD CONSTRAINT "evaluation_comparisons_baseline_run_fk" FOREIGN KEY ("baseline_evaluation_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_comparisons" ADD CONSTRAINT "evaluation_comparisons_candidate_run_fk" FOREIGN KEY ("candidate_evaluation_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_comparisons" ADD CONSTRAINT "evaluation_comparisons_suite_version_fk" FOREIGN KEY ("evaluation_suite_version_id") REFERENCES "public"."evaluation_suite_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "evaluation_comparison_pairwise_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"comparison_id" text NOT NULL,
	"evaluation_case_id" text NOT NULL,
	"judgment_position" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"execution_owner" text,
	"execution_generation" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"terminal_result" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "evaluation_comparison_pairwise_tasks_case_position_unique" UNIQUE("comparison_id","evaluation_case_id","judgment_position"),
	CONSTRAINT "evaluation_comparison_pairwise_tasks_status_check" CHECK ("status" in ('PENDING','RUNNING','SUCCEEDED','FAILED')),
	CONSTRAINT "evaluation_comparison_pairwise_tasks_position_check" CHECK ("judgment_position" in ('PRIMARY','REVERSED')),
	CONSTRAINT "evaluation_comparison_pairwise_tasks_attempt_count_positive" CHECK ("attempt_count" >= 0),
	CONSTRAINT "evaluation_comparison_pairwise_tasks_max_attempts_positive" CHECK ("max_attempts" > 0)
);
--> statement-breakpoint
CREATE INDEX "evaluation_comparison_pairwise_tasks_recovery_idx" ON "evaluation_comparison_pairwise_tasks" ("status","lease_expires_at","created_at","id");
--> statement-breakpoint
ALTER TABLE "evaluation_comparison_pairwise_tasks" ADD CONSTRAINT "evaluation_comparison_pairwise_tasks_comparison_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."evaluation_comparisons"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_comparison_pairwise_tasks" ADD CONSTRAINT "evaluation_comparison_pairwise_tasks_case_fk" FOREIGN KEY ("evaluation_case_id") REFERENCES "public"."evaluation_cases"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "evaluation_comparison_human_review_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"comparison_id" text NOT NULL,
	"evaluation_case_id" text NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"decision" text NOT NULL,
	"rationale" text,
	"evidence_reference" text NOT NULL,
	"supersedes_revision_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evaluation_comparison_human_review_decision_check" CHECK ("decision" in ('BASELINE_BETTER','CANDIDATE_BETTER','TIE','UNSURE'))
);
--> statement-breakpoint
CREATE INDEX "evaluation_comparison_human_reviews_comparison_case_idx" ON "evaluation_comparison_human_review_revisions" ("comparison_id","evaluation_case_id","created_at","id");
--> statement-breakpoint
ALTER TABLE "evaluation_comparison_human_review_revisions" ADD CONSTRAINT "evaluation_comparison_human_reviews_comparison_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."evaluation_comparisons"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_comparison_human_review_revisions" ADD CONSTRAINT "evaluation_comparison_human_reviews_case_fk" FOREIGN KEY ("evaluation_case_id") REFERENCES "public"."evaluation_cases"("id") ON DELETE no action ON UPDATE no action;