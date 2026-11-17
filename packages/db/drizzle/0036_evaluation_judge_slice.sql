CREATE TABLE "evaluation_judge_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"evaluation_run_id" text NOT NULL,
	"evaluation_case_id" text NOT NULL,
	"run_id" text NOT NULL,
	"run_attempt_id" text NOT NULL,
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
	CONSTRAINT "evaluation_judge_tasks_run_case_unique" UNIQUE("evaluation_run_id","evaluation_case_id"),
	CONSTRAINT "evaluation_judge_tasks_status_check" CHECK ("status" in ('PENDING','RUNNING','SUCCEEDED','FAILED')),
	CONSTRAINT "evaluation_judge_tasks_attempt_count_positive" CHECK ("attempt_count" >= 0),
	CONSTRAINT "evaluation_judge_tasks_max_attempts_positive" CHECK ("max_attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "evaluation_judge_tasks" ADD CONSTRAINT "evaluation_judge_tasks_evaluation_run_id_fk" FOREIGN KEY ("evaluation_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_judge_tasks" ADD CONSTRAINT "evaluation_judge_tasks_evaluation_case_id_fk" FOREIGN KEY ("evaluation_case_id") REFERENCES "public"."evaluation_cases"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_judge_tasks" ADD CONSTRAINT "evaluation_judge_tasks_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "evaluation_judge_tasks" ADD CONSTRAINT "evaluation_judge_tasks_run_attempt_id_fk" FOREIGN KEY ("run_attempt_id") REFERENCES "public"."run_attempts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "evaluation_judge_tasks_recovery_idx" ON "evaluation_judge_tasks" USING btree ("status","lease_expires_at","created_at","id");