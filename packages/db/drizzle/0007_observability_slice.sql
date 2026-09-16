ALTER TABLE "run_steps" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "run_steps" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "run_steps" DROP COLUMN "metadata";--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "kind" text NOT NULL;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "binding_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "status" text NOT NULL;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "model_profile_version_id" text;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "tool_version_id" text;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "cached_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "estimated_cost_usd_micros" bigint;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_kind_check" CHECK ("run_steps"."kind" in ('MODEL', 'TOOL'));--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_status_check" CHECK ("run_steps"."status" in ('RUNNING', 'SUCCEEDED', 'FAILED'));--> statement-breakpoint
CREATE INDEX "run_steps_run_attempt_started_at_id_idx" ON "run_steps" USING btree ("run_attempt_id","started_at","id");--> statement-breakpoint
ALTER TABLE "model_profile_versions" ADD COLUMN "pricing" jsonb;--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"run_attempt_id" text NOT NULL,
	"evaluator_type" text NOT NULL,
	"expected" jsonb NOT NULL,
	"passed" boolean NOT NULL,
	"score" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evaluations_evaluator_type_check" CHECK ("evaluations"."evaluator_type" in ('JSON_EXACT_MATCH'))
);
--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_run_attempt_same_run_fk" FOREIGN KEY ("run_id","run_attempt_id") REFERENCES "public"."run_attempts"("run_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evaluations_run_attempt_created_at_id_idx" ON "evaluations" USING btree ("run_attempt_id","created_at","id");
