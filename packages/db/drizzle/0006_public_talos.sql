CREATE TABLE "tool_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tool_id" text NOT NULL,
	"version" integer NOT NULL,
	"type" text NOT NULL,
	"implementation" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tool_versions_tool_id_version_unique" UNIQUE("tool_id","version"),
	CONSTRAINT "tool_versions_tool_id_id_unique" UNIQUE("tool_id","id"),
	CONSTRAINT "tool_versions_version_positive" CHECK ("tool_versions"."version" > 0),
	CONSTRAINT "tool_versions_type_check" CHECK ("tool_versions"."type" in ('INTERNAL'))
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tools_workspace_id_key_unique" UNIQUE("workspace_id","key"),
	CONSTRAINT "tools_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "tool_version_bindings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_versions" ADD CONSTRAINT "tool_versions_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;