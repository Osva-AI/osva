CREATE TABLE "model_provider_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "model_provider_connections_workspace_id_key_unique" UNIQUE("workspace_id","key"),
	CONSTRAINT "model_provider_connections_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "model_provider_connections" ADD CONSTRAINT "model_provider_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "model_provider_connection_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"version" integer NOT NULL,
	"endpoint" jsonb,
	"credential_ref" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "model_provider_connection_versions_connection_id_version_unique" UNIQUE("connection_id","version"),
	CONSTRAINT "model_provider_connection_versions_connection_id_id_unique" UNIQUE("connection_id","id"),
	CONSTRAINT "model_provider_connection_versions_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
ALTER TABLE "model_provider_connection_versions" ADD CONSTRAINT "model_provider_connection_versions_connection_id_model_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."model_provider_connections"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "model_profile_versions" ADD COLUMN "model_provider_connection_version_id" text;
--> statement-breakpoint
ALTER TABLE "model_profile_versions" ADD CONSTRAINT "model_profile_versions_model_provider_connection_version_id_model_provider_connection_versions_id_fk" FOREIGN KEY ("model_provider_connection_version_id") REFERENCES "public"."model_provider_connection_versions"("id") ON DELETE no action ON UPDATE no action;
