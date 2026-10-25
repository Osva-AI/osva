ALTER TABLE "approval_requests" ADD COLUMN "operation_kind" text;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "operation_digest" text;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "expires_at" timestamp with time zone;
