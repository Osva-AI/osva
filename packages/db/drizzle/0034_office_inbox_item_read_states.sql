CREATE TABLE "office_inbox_item_read_states" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "office_inbox_item_read_states_pk" PRIMARY KEY("workspace_id","user_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "office_inbox_item_read_states" ADD CONSTRAINT "office_inbox_item_read_states_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
