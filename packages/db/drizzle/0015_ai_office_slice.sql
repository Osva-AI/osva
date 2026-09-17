CREATE TABLE "office_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"agent_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "office_workers_workspace_id_key_unique" UNIQUE("workspace_id","key"),
	CONSTRAINT "office_workers_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "office_workers" ADD CONSTRAINT "office_workers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "office_workers" ADD CONSTRAINT "office_workers_workspace_id_agent_id_agents_fk" FOREIGN KEY ("workspace_id","agent_id") REFERENCES "public"."agents"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "roles_workspace_id_key_unique" UNIQUE("workspace_id","key"),
	CONSTRAINT "roles_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "teams_workspace_id_key_unique" UNIQUE("workspace_id","key"),
	CONSTRAINT "teams_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"team_id" text NOT NULL,
	"office_worker_id" text NOT NULL,
	"role_id" text,
	CONSTRAINT "team_memberships_team_id_office_worker_id_unique" UNIQUE("team_id","office_worker_id")
);
--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_office_worker_id_office_workers_fk" FOREIGN KEY ("office_worker_id") REFERENCES "public"."office_workers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_role_id_roles_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "goals_workspace_id_key_unique" UNIQUE("workspace_id","key"),
	CONSTRAINT "goals_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"goal_id" text,
	"office_worker_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"target_type" text NOT NULL,
	"target_version_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" text NOT NULL,
	"run_id" text,
	"workflow_run_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "assignments_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_office_worker_id_office_workers_id_fk" FOREIGN KEY ("office_worker_id") REFERENCES "public"."office_workers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_workspace_id_office_worker_id_office_workers_fk" FOREIGN KEY ("workspace_id","office_worker_id") REFERENCES "public"."office_workers"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_workspace_id_goal_id_goals_fk" FOREIGN KEY ("workspace_id","goal_id") REFERENCES "public"."goals"("workspace_id","id") ON DELETE no action ON UPDATE no action;
