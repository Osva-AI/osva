ALTER TABLE "run_steps" ADD COLUMN "model_invocation_source" text;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "estimated_avoided_cost_usd_micros" bigint;