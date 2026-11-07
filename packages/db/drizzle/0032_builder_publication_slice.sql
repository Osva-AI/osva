CREATE TABLE "builder_publications" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"plan_digest" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "builder_publications_workspace_id_idempotency_key_unique" UNIQUE("workspace_id","idempotency_key"),
	CONSTRAINT "builder_publications_idempotency_key_nonempty" CHECK (char_length("idempotency_key") > 0),
	CONSTRAINT "builder_publications_plan_digest_nonempty" CHECK (char_length("plan_digest") > 0)
);
--> statement-breakpoint
ALTER TABLE "builder_publications" ADD CONSTRAINT "builder_publications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
