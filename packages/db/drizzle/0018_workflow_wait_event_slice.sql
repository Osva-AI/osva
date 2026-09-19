ALTER TABLE "workflow_node_runs" ADD CONSTRAINT "workflow_node_runs_workspace_id_workflow_run_id_id_unique" UNIQUE("workspace_id","workflow_run_id","id");
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"correlation_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflow_events_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "workflow_events_workspace_id_source_idempotency_key_unique" UNIQUE("workspace_id","source","idempotency_key"),
	CONSTRAINT "workflow_events_source_nonempty" CHECK (char_length("source") > 0),
	CONSTRAINT "workflow_events_event_type_nonempty" CHECK (char_length("event_type") > 0),
	CONSTRAINT "workflow_events_correlation_key_nonempty" CHECK (char_length("correlation_key") > 0),
	CONSTRAINT "workflow_events_idempotency_key_nonempty" CHECK (char_length("idempotency_key") > 0)
);
--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workflow_events_candidate_lookup_idx" ON "workflow_events" USING btree ("workspace_id","source","event_type","correlation_key","received_at","id");
--> statement-breakpoint
CREATE TABLE "workflow_waits" (
	"workflow_node_run_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_run_id" text NOT NULL,
	"kind" text NOT NULL,
	"armed_at" timestamp with time zone NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_event_id" text,
	"wake_at" timestamp with time zone,
	"event_source" text,
	"event_type" text,
	"correlation_key" text,
	"eligible_from" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "workflow_waits_kind_check" CHECK ("kind" in ('TIMER','EVENT')),
	CONSTRAINT "workflow_waits_resolution_check" CHECK ("resolution" is null or "resolution" in ('TIMER','EVENT','TIMEOUT','CANCELLED')),
	CONSTRAINT "workflow_waits_resolution_timestamps_check" CHECK ((
		"resolution" is null
		and "resolved_at" is null
		and "resolved_by_event_id" is null
	) or (
		"resolution" is not null
		and "resolved_at" is not null
		and "resolved_at" >= "armed_at"
	)),
	CONSTRAINT "workflow_waits_resolution_event_id_check" CHECK ((
		"resolution" = 'EVENT'
		and "resolved_by_event_id" is not null
	) or (
		"resolution" is distinct from 'EVENT'
		and "resolved_by_event_id" is null
	)),
	CONSTRAINT "workflow_waits_timer_kind_check" CHECK ("kind" <> 'TIMER' or (
		"wake_at" is not null
		and "event_source" is null
		and "event_type" is null
		and "correlation_key" is null
		and "eligible_from" is null
		and "expires_at" is null
		and (
			"resolution" is null
			or "resolution" in ('TIMER','CANCELLED')
		)
	)),
	CONSTRAINT "workflow_waits_event_kind_check" CHECK ("kind" <> 'EVENT' or (
		"wake_at" is null
		and "event_source" is not null
		and char_length("event_source") > 0
		and "event_type" is not null
		and char_length("event_type") > 0
		and "correlation_key" is not null
		and char_length("correlation_key") > 0
		and "eligible_from" is not null
		and "eligible_from" <= "armed_at"
		and (
			"expires_at" is null
			or "expires_at" > "armed_at"
		)
		and (
			"resolution" is null
			or "resolution" in ('EVENT','TIMEOUT','CANCELLED')
		)
		and (
			"resolution" is distinct from 'TIMEOUT'
			or "expires_at" is not null
		)
	))
);
--> statement-breakpoint
ALTER TABLE "workflow_waits" ADD CONSTRAINT "workflow_waits_workspace_id_workflow_run_id_node_run_fk" FOREIGN KEY ("workspace_id","workflow_run_id","workflow_node_run_id") REFERENCES "public"."workflow_node_runs"("workspace_id","workflow_run_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_waits" ADD CONSTRAINT "workflow_waits_workspace_id_resolved_by_event_id_fk" FOREIGN KEY ("workspace_id","resolved_by_event_id") REFERENCES "public"."workflow_events"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workflow_waits_workflow_run_id_node_run_id_idx" ON "workflow_waits" USING btree ("workflow_run_id","workflow_node_run_id");
--> statement-breakpoint
CREATE INDEX "workflow_waits_timer_due_idx" ON "workflow_waits" USING btree ("wake_at","workflow_node_run_id") WHERE "kind" = 'TIMER' AND "resolution" IS NULL;
--> statement-breakpoint
CREATE INDEX "workflow_waits_event_timeout_idx" ON "workflow_waits" USING btree ("expires_at","workflow_node_run_id") WHERE "kind" = 'EVENT' AND "resolution" IS NULL AND "expires_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "workflow_waits_event_match_idx" ON "workflow_waits" USING btree ("workspace_id","event_source","event_type","correlation_key","workflow_node_run_id") WHERE "kind" = 'EVENT' AND "resolution" IS NULL;
