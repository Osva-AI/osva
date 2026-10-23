ALTER TABLE "evaluation_runs" ADD COLUMN "quality_gate_policy" jsonb;
--> statement-breakpoint
CREATE TABLE "evaluation_run_gate_assessments" (
	"evaluation_run_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"assessment" jsonb NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluation_run_gate_assessments" ADD CONSTRAINT "evaluation_run_gate_assessments_evaluation_run_id_fk" FOREIGN KEY ("evaluation_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE no action ON UPDATE no action;
