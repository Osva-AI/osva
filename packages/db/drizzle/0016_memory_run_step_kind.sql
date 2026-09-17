ALTER TABLE "run_steps" DROP CONSTRAINT "run_steps_kind_check";--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_kind_check" CHECK ("run_steps"."kind" in ('MODEL', 'TOOL', 'MEMORY'));
