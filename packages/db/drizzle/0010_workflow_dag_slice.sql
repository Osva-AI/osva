ALTER TABLE "workflow_node_runs" DROP CONSTRAINT "workflow_node_runs_status_check";
--> statement-breakpoint
ALTER TABLE "workflow_node_runs" ADD CONSTRAINT "workflow_node_runs_status_check" CHECK ("workflow_node_runs"."status" in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'));
--> statement-breakpoint
ALTER TABLE "workflow_node_runs" ADD COLUMN "selected_target_key" text;
