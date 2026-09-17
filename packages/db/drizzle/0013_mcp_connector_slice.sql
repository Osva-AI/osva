CREATE TABLE "connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "connectors_workspace_id_key_unique" UNIQUE("workspace_id","key"),
	CONSTRAINT "connectors_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "connector_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_id" text NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"transport" text NOT NULL,
	"transport_config" jsonb NOT NULL,
	"auth" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "connector_versions_connector_id_version_unique" UNIQUE("connector_id","version"),
	CONSTRAINT "connector_versions_connector_id_id_unique" UNIQUE("connector_id","id"),
	CONSTRAINT "connector_versions_version_positive" CHECK ("version" > 0),
	CONSTRAINT "connector_versions_kind_check" CHECK ("kind" in ('MCP')),
	CONSTRAINT "connector_versions_transport_check" CHECK ("transport" in ('STREAMABLE_HTTP','STDIO'))
);
--> statement-breakpoint
ALTER TABLE "connector_versions" ADD CONSTRAINT "connector_versions_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tool_versions" ADD COLUMN "mcp_config" jsonb;
--> statement-breakpoint
ALTER TABLE "tool_versions" DROP CONSTRAINT IF EXISTS "tool_versions_type_check";
--> statement-breakpoint
ALTER TABLE "tool_versions" ADD CONSTRAINT "tool_versions_type_check" CHECK ("type" in ('INTERNAL','MCP'));
