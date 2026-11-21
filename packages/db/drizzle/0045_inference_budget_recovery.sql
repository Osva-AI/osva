ALTER TABLE "inference_invocations" ADD COLUMN "execution_generation" integer;--> statement-breakpoint
ALTER TABLE "inference_invocations" ADD COLUMN "last_execution_generation" integer;--> statement-breakpoint
ALTER TABLE "inference_budget_reservations" ADD COLUMN "admitted_execution_generation" integer;--> statement-breakpoint
ALTER TABLE "inference_budget_reservations" ADD COLUMN "provider_started_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "inference_model_invocation_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_attempt_id" text NOT NULL,
	"binding_name" text NOT NULL,
	"logical_operation_key" text NOT NULL,
	"model_invocation_ordinal" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inference_model_invocation_slots_ordinal_check" CHECK ("model_invocation_ordinal" >= 1),
	CONSTRAINT "inference_model_invocation_slots_workspace_key_unique" UNIQUE("workspace_id","run_attempt_id","binding_name","logical_operation_key")
);
--> statement-breakpoint
ALTER TABLE "inference_model_invocation_slots" ADD CONSTRAINT "inference_model_invocation_slots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inference_model_invocation_slots_attempt_idx" ON "inference_model_invocation_slots" USING btree ("run_attempt_id","binding_name");