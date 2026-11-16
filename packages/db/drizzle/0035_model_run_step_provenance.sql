ALTER TABLE "run_steps" ADD COLUMN "cache_write_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "usage_incomplete" boolean;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "provider_reported_model_id" text;--> statement-breakpoint
ALTER TABLE "run_steps" ADD COLUMN "provider_request_id" text;