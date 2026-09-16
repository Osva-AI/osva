ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_status_check";
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_status_check" CHECK ("workflow_runs"."status" in ('PENDING', 'RUNNING', 'WAITING_FOR_APPROVAL', 'SUCCEEDED', 'FAILED'));
--> statement-breakpoint
ALTER TABLE "workflow_node_runs" DROP CONSTRAINT "workflow_node_runs_status_check";
--> statement-breakpoint
ALTER TABLE "workflow_node_runs" ADD CONSTRAINT "workflow_node_runs_status_check" CHECK ("workflow_node_runs"."status" in ('PENDING', 'RUNNING', 'WAITING_FOR_APPROVAL', 'SUCCEEDED', 'FAILED', 'SKIPPED'));
--> statement-breakpoint
ALTER TABLE "workflow_node_runs" ADD CONSTRAINT "workflow_node_runs_workspace_id_id_unique" UNIQUE("workspace_id","id");
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_run_id" text NOT NULL,
	"workflow_node_run_id" text NOT NULL,
	"status" text NOT NULL,
	"decision_comment" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "approval_requests_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "approval_requests_workflow_node_run_id_unique" UNIQUE("workflow_node_run_id"),
	CONSTRAINT "approval_requests_status_check" CHECK ("approval_requests"."status" in ('PENDING', 'APPROVED', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_workflow_run_id_fk" FOREIGN KEY ("workspace_id","workflow_run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_workflow_node_run_id_fk" FOREIGN KEY ("workspace_id","workflow_node_run_id") REFERENCES "public"."workflow_node_runs"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "approval_requests_workflow_run_id_idx" ON "approval_requests" USING btree ("workflow_run_id");
--> statement-breakpoint
CREATE INDEX "approval_requests_workspace_id_status_idx" ON "approval_requests" USING btree ("workspace_id","status");
