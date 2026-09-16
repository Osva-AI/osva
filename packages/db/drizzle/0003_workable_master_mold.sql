CREATE INDEX "runs_created_at_id_idx" ON "runs" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "runs_agent_id_created_at_id_idx" ON "runs" USING btree ("agent_id","created_at","id");--> statement-breakpoint
CREATE INDEX "runs_agent_version_id_created_at_id_idx" ON "runs" USING btree ("agent_version_id","created_at","id");--> statement-breakpoint
CREATE INDEX "runs_status_created_at_id_idx" ON "runs" USING btree ("status","created_at","id");