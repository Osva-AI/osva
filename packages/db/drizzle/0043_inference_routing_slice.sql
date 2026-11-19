CREATE TABLE "inference_routing_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inference_routing_policies_workspace_key_unique" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE "inference_routing_policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"definition_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inference_routing_policy_versions_policy_version_unique" UNIQUE("policy_id","version")
);
--> statement-breakpoint
CREATE TABLE "workspace_inference_routing_activation" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"active_policy_version_id" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inference_routing_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"policy_version_id" text NOT NULL,
	"decision_json" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inference_routing_policies" ADD CONSTRAINT "inference_routing_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inference_routing_policy_versions" ADD CONSTRAINT "inference_routing_policy_versions_policy_id_inference_routing_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."inference_routing_policies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inference_routing_policy_versions" ADD CONSTRAINT "inference_routing_policy_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_inference_routing_activation" ADD CONSTRAINT "workspace_inference_routing_activation_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_inference_routing_activation" ADD CONSTRAINT "workspace_inference_routing_activation_active_policy_version_id_inference_routing_policy_versions_id_fk" FOREIGN KEY ("active_policy_version_id") REFERENCES "public"."inference_routing_policy_versions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inference_routing_decisions" ADD CONSTRAINT "inference_routing_decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inference_routing_decisions" ADD CONSTRAINT "inference_routing_decisions_policy_version_id_inference_routing_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."inference_routing_policy_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inference_routing_policies_workspace_id_idx" ON "inference_routing_policies" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "inference_routing_policy_versions_workspace_id_idx" ON "inference_routing_policy_versions" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "inference_routing_decisions_workspace_created_idx" ON "inference_routing_decisions" USING btree ("workspace_id","created_at");