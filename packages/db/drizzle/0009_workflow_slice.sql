CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflows_workspace_id_key_unique" UNIQUE("workspace_id","key"),
	CONSTRAINT "workflows_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflow_versions_workflow_id_version_unique" UNIQUE("workflow_id","version"),
	CONSTRAINT "workflow_versions_workflow_id_id_unique" UNIQUE("workflow_id","id"),
	CONSTRAINT "workflow_versions_version_positive" CHECK ("workflow_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_version_id" text NOT NULL,
	"status" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflow_runs_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "workflow_runs_status_check" CHECK ("workflow_runs"."status" in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "workflow_node_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_run_id" text NOT NULL,
	"workflow_node_key" text NOT NULL,
	"sequence" integer NOT NULL,
	"status" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"child_run_id" text,
	"error" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflow_node_runs_workflow_run_id_key_unique" UNIQUE("workflow_run_id","workflow_node_key"),
	CONSTRAINT "workflow_node_runs_workflow_run_id_sequence_unique" UNIQUE("workflow_run_id","sequence"),
	CONSTRAINT "workflow_node_runs_sequence_positive" CHECK ("workflow_node_runs"."sequence" > 0),
	CONSTRAINT "workflow_node_runs_status_check" CHECK ("workflow_node_runs"."status" in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workspace_id_workflow_id_workflows_fk" FOREIGN KEY ("workspace_id","workflow_id") REFERENCES "public"."workflows"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_id_workflow_id_workflows_fk" FOREIGN KEY ("workspace_id","workflow_id") REFERENCES "public"."workflows"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflow_version_id_fk" FOREIGN KEY ("workflow_id","workflow_version_id") REFERENCES "public"."workflow_versions"("workflow_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_runs" ADD CONSTRAINT "workflow_node_runs_workspace_id_workflow_run_id_fk" FOREIGN KEY ("workspace_id","workflow_run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_runs" ADD CONSTRAINT "workflow_node_runs_child_run_id_runs_fk" FOREIGN KEY ("child_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_runs_status_created_at_id_idx" ON "workflow_runs" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_node_runs_child_run_id_unique" ON "workflow_node_runs" USING btree ("child_run_id") WHERE "workflow_node_runs"."child_run_id" is not null;
