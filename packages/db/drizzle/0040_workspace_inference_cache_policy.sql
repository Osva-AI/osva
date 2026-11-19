CREATE TABLE "workspace_inference_cache_policies" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"schema_version" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"determinism" text NOT NULL,
	"ttl_seconds" integer,
	"max_entry_bytes" integer,
	"allow_evaluation_judge_cache" boolean DEFAULT false NOT NULL,
	"allow_tool_definitions" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_inference_cache_policies_determinism_check" CHECK ("determinism" in ('PROVIDER_DEFAULT', 'REQUIRED_DETERMINISTIC'))
);
--> statement-breakpoint
ALTER TABLE "workspace_inference_cache_policies" ADD CONSTRAINT "workspace_inference_cache_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;