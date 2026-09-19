ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_status_check";
--> statement-breakpoint
UPDATE "workflow_runs" SET "status" = 'WAITING' WHERE "status" = 'WAITING_FOR_APPROVAL';
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_status_check" CHECK ("workflow_runs"."status" in ('PENDING', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELLED'));
--> statement-breakpoint
ALTER TABLE "workflow_node_runs" DROP CONSTRAINT "workflow_node_runs_status_check";
--> statement-breakpoint
UPDATE "workflow_node_runs" SET "status" = 'WAITING' WHERE "status" = 'WAITING_FOR_APPROVAL';
--> statement-breakpoint
ALTER TABLE "workflow_node_runs" ADD CONSTRAINT "workflow_node_runs_status_check" CHECK ("workflow_node_runs"."status" in ('PENDING', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'));
