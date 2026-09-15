ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_id_unique" UNIQUE("agent_id","id");
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_id_unique" UNIQUE("workspace_id","id");
--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_agent_version_id_agent_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_agent_version_id_agent_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_workspace_id_agent_id_agents_fk" FOREIGN KEY ("workspace_id","agent_id") REFERENCES "public"."agents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_agent_id_agent_version_id_agent_versions_fk" FOREIGN KEY ("agent_id","agent_version_id") REFERENCES "public"."agent_versions"("agent_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_agent_id_agents_fk" FOREIGN KEY ("workspace_id","agent_id") REFERENCES "public"."agents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_id_agent_version_id_agent_versions_fk" FOREIGN KEY ("agent_id","agent_version_id") REFERENCES "public"."agent_versions"("agent_id","id") ON DELETE no action ON UPDATE no action;
