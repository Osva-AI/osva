CREATE TABLE "model_profile_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"model_profile_id" text NOT NULL,
	"version" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "model_profile_versions_model_profile_id_version_unique" UNIQUE("model_profile_id","version"),
	CONSTRAINT "model_profile_versions_model_profile_id_id_unique" UNIQUE("model_profile_id","id"),
	CONSTRAINT "model_profile_versions_version_positive" CHECK ("model_profile_versions"."version" > 0),
	CONSTRAINT "model_profile_versions_provider_check" CHECK ("model_profile_versions"."provider" in ('OPENAI'))
);
--> statement-breakpoint
CREATE TABLE "model_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "model_profiles_workspace_id_key_unique" UNIQUE("workspace_id","key"),
	CONSTRAINT "model_profiles_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "model_profile_versions" ADD CONSTRAINT "model_profile_versions_model_profile_id_model_profiles_id_fk" FOREIGN KEY ("model_profile_id") REFERENCES "public"."model_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_profiles" ADD CONSTRAINT "model_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;