ALTER TABLE "run_attempts" ADD COLUMN "execution_owner" text;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD COLUMN "execution_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_attempts" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "run_attempts_expired_lease_idx" ON "run_attempts" ("lease_expires_at") WHERE "status" = 'RUNNING' AND "execution_owner" IS NOT NULL;
