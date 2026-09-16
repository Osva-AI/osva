CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_version_id" text NOT NULL,
	"cron_expression" text NOT NULL,
	"timezone" text NOT NULL,
	"input" jsonb NOT NULL,
	"enabled" boolean NOT NULL,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_occurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_version_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_workspace_id_agent_id_agents_fk" FOREIGN KEY ("workspace_id","agent_id") REFERENCES "public"."agents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_agent_id_agent_version_id_agent_versions_fk" FOREIGN KEY ("agent_id","agent_version_id") REFERENCES "public"."agent_versions"("agent_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_workspace_id_key_unique" ON "schedules" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "schedules_enabled_next_run_at_id_idx" ON "schedules" USING btree ("enabled","next_run_at","id");--> statement-breakpoint
CREATE INDEX "schedules_workspace_created_at_id_idx" ON "schedules" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_occurrences_schedule_id_scheduled_for_unique" ON "schedule_occurrences" USING btree ("schedule_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "schedule_occurrences_schedule_scheduled_for_id_idx" ON "schedule_occurrences" USING btree ("schedule_id","scheduled_for","id");--> statement-breakpoint
CREATE INDEX "schedule_occurrences_dispatched_at_scheduled_for_id_idx" ON "schedule_occurrences" USING btree ("dispatched_at","scheduled_for","id");
