CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"digest_sha256" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"producer_run_id" text,
	"producer_run_attempt_id" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "artifacts_size_bytes_non_negative" CHECK ("size_bytes" >= 0),
	CONSTRAINT "artifacts_producer_pair_consistency" CHECK (("producer_run_id" is null and "producer_run_attempt_id" is null) or ("producer_run_id" is not null and "producer_run_attempt_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_producer_run_id_runs_id_fk" FOREIGN KEY ("producer_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_producer_run_attempt_fk" FOREIGN KEY ("producer_run_id","producer_run_attempt_id") REFERENCES "public"."run_attempts"("run_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_workspace_id_idempotency_key_unique" ON "artifacts" USING btree ("workspace_id","idempotency_key") WHERE "idempotency_key" is not null;
--> statement-breakpoint
CREATE INDEX "artifacts_workspace_id_created_at_id_idx" ON "artifacts" USING btree ("workspace_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "artifacts_producer_run_id_created_at_id_idx" ON "artifacts" USING btree ("producer_run_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "artifacts_producer_run_attempt_id_created_at_id_idx" ON "artifacts" USING btree ("producer_run_attempt_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "artifacts_workspace_id_digest_sha256_idx" ON "artifacts" USING btree ("workspace_id","digest_sha256");
