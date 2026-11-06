ALTER TABLE "runs" DROP CONSTRAINT "runs_status_check";--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_status_check" CHECK ("status" in ('PENDING', 'QUEUED', 'RUNNING', 'INTERRUPTED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'));--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "recovery_metadata" jsonb;--> statement-breakpoint
CREATE TABLE "run_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"run_attempt_id" text NOT NULL,
	"execution_generation" integer NOT NULL,
	"runtime_kind" text NOT NULL,
	"envelope_version" text NOT NULL,
	"state_schema_version" text NOT NULL,
	"agent_version_id" text NOT NULL,
	"binding_identity" jsonb NOT NULL,
	"binding_digest" text NOT NULL,
	"cursor" jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"payload_digest" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_checkpoints_sequence_positive" CHECK ("sequence" > 0),
	CONSTRAINT "run_checkpoints_runtime_kind_check" CHECK ("runtime_kind" = 'DECLARATIVE')
);
--> statement-breakpoint
ALTER TABLE "run_checkpoints" ADD CONSTRAINT "run_checkpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_checkpoints" ADD CONSTRAINT "run_checkpoints_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_checkpoints" ADD CONSTRAINT "run_checkpoints_run_attempt_fk" FOREIGN KEY ("run_id","run_attempt_id") REFERENCES "public"."run_attempts"("run_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_checkpoints_run_id_sequence_unique" ON "run_checkpoints" ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "run_checkpoints_run_id_idempotency_key_unique" ON "run_checkpoints" ("run_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "run_checkpoints_run_id_sequence_desc_idx" ON "run_checkpoints" ("run_id","sequence");--> statement-breakpoint
CREATE TABLE "run_operation_journal" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"run_attempt_id" text NOT NULL,
	"execution_generation" integer NOT NULL,
	"operation_key" text NOT NULL,
	"tool_version_id" text NOT NULL,
	"binding_name" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"idempotency_class" text NOT NULL,
	"status" text NOT NULL,
	"committed_result" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_operation_journal_status_check" CHECK ("status" in ('PENDING', 'COMMITTED', 'UNCERTAIN', 'FAILED')),
	CONSTRAINT "run_operation_journal_idempotency_class_check" CHECK ("idempotency_class" in ('PURE', 'READ_ONLY', 'IDEMPOTENT_WRITE', 'RECONCILE', 'UNKNOWN_WRITE'))
);
--> statement-breakpoint
ALTER TABLE "run_operation_journal" ADD CONSTRAINT "run_operation_journal_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_operation_journal" ADD CONSTRAINT "run_operation_journal_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_operation_journal" ADD CONSTRAINT "run_operation_journal_run_attempt_fk" FOREIGN KEY ("run_id","run_attempt_id") REFERENCES "public"."run_attempts"("run_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_operation_journal_run_operation_key_unique" ON "run_operation_journal" ("run_id","operation_key");--> statement-breakpoint
CREATE INDEX "run_operation_journal_run_id_status_idx" ON "run_operation_journal" ("run_id","status");--> statement-breakpoint
CREATE INDEX "runs_interrupted_recovery_idx" ON "runs" ("status","updated_at") WHERE "status" = 'INTERRUPTED';
