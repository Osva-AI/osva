CREATE TABLE "office_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"team_id" text,
	"goal_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"latest_message_sequence" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "office_threads_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "office_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"author_type" text NOT NULL,
	"author_user_id" text,
	"author_office_worker_id" text,
	"body" text NOT NULL,
	"parent_message_id" text,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resource_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "office_messages_thread_id_sequence_unique" UNIQUE("thread_id","sequence"),
	CONSTRAINT "office_messages_workspace_thread_idempotency_unique" UNIQUE("workspace_id","thread_id","idempotency_key"),
	CONSTRAINT "office_messages_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "office_inbox_read_states" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"last_read_sequence" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "office_inbox_read_states_pk" PRIMARY KEY("workspace_id","user_id","thread_id")
);
--> statement-breakpoint
ALTER TABLE "office_threads" ADD CONSTRAINT "office_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "office_threads" ADD CONSTRAINT "office_threads_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "office_threads" ADD CONSTRAINT "office_threads_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "office_messages" ADD CONSTRAINT "office_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "office_messages" ADD CONSTRAINT "office_messages_thread_id_office_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."office_threads"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "office_inbox_read_states" ADD CONSTRAINT "office_inbox_read_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "office_inbox_read_states" ADD CONSTRAINT "office_inbox_read_states_thread_id_office_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."office_threads"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "office_threads_workspace_id_updated_at_idx" ON "office_threads" USING btree ("workspace_id","updated_at" DESC,"id");
--> statement-breakpoint
CREATE INDEX "office_messages_thread_id_sequence_idx" ON "office_messages" USING btree ("thread_id","sequence");
--> statement-breakpoint
CREATE INDEX "office_messages_workspace_created_at_idx" ON "office_messages" USING btree ("workspace_id","created_at" DESC,"id");
