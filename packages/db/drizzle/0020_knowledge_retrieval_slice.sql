CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"artifact_id" text NOT NULL,
	"attributes" jsonb NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_indexes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"knowledge_source_id" text NOT NULL,
	"status" text NOT NULL,
	"parser_key" text NOT NULL,
	"parser_version" text NOT NULL,
	"chunker_key" text NOT NULL,
	"chunker_version" text NOT NULL,
	"chunk_size" integer NOT NULL,
	"chunk_overlap" integer NOT NULL,
	"embedding_provider" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_dimensions" integer NOT NULL,
	"distance_metric" text NOT NULL,
	"pipeline_fingerprint" text NOT NULL,
	"extracted_artifact_id" text,
	"attempt_count" integer NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"chunk_count" integer,
	"embedded_chunk_count" integer,
	"last_error_code" text,
	"last_error_message" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ready_at" timestamp with time zone,
	CONSTRAINT "knowledge_indexes_chunk_size_positive" CHECK ("chunk_size" > 0),
	CONSTRAINT "knowledge_indexes_chunk_overlap_non_negative" CHECK ("chunk_overlap" >= 0),
	CONSTRAINT "knowledge_indexes_embedding_dimensions_positive" CHECK ("embedding_dimensions" > 0),
	CONSTRAINT "knowledge_indexes_attempt_count_non_negative" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"knowledge_index_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"text_sha256" text NOT NULL,
	"location" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "knowledge_chunks_ordinal_non_negative" CHECK ("ordinal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_vectors" (
	"workspace_id" text NOT NULL,
	"knowledge_index_id" text NOT NULL,
	"knowledge_chunk_id" text NOT NULL,
	"embedding" vector NOT NULL,
	CONSTRAINT "knowledge_vectors_pkey" PRIMARY KEY ("knowledge_chunk_id")
);
--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_indexes" ADD CONSTRAINT "knowledge_indexes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_indexes" ADD CONSTRAINT "knowledge_indexes_knowledge_source_id_fk" FOREIGN KEY ("knowledge_source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_indexes" ADD CONSTRAINT "knowledge_indexes_extracted_artifact_id_fk" FOREIGN KEY ("extracted_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_knowledge_index_id_fk" FOREIGN KEY ("knowledge_index_id") REFERENCES "public"."knowledge_indexes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_vectors" ADD CONSTRAINT "knowledge_vectors_knowledge_index_id_fk" FOREIGN KEY ("knowledge_index_id") REFERENCES "public"."knowledge_indexes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_vectors" ADD CONSTRAINT "knowledge_vectors_knowledge_chunk_id_fk" FOREIGN KEY ("knowledge_chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sources_workspace_id_key_unique" ON "knowledge_sources" USING btree ("workspace_id","key");
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sources_workspace_id_idempotency_key_unique" ON "knowledge_sources" USING btree ("workspace_id","idempotency_key") WHERE "idempotency_key" is not null;
--> statement-breakpoint
CREATE INDEX "knowledge_sources_workspace_id_created_at_id_idx" ON "knowledge_sources" USING btree ("workspace_id","created_at","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_indexes_workspace_id_idempotency_key_unique" ON "knowledge_indexes" USING btree ("workspace_id","idempotency_key") WHERE "idempotency_key" is not null;
--> statement-breakpoint
CREATE INDEX "knowledge_indexes_workspace_id_source_id_created_at_id_idx" ON "knowledge_indexes" USING btree ("workspace_id","knowledge_source_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "knowledge_indexes_status_lease_expires_at_idx" ON "knowledge_indexes" USING btree ("status","lease_expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_index_id_ordinal_unique" ON "knowledge_chunks" USING btree ("knowledge_index_id","ordinal");
--> statement-breakpoint
CREATE INDEX "knowledge_vectors_workspace_index_idx" ON "knowledge_vectors" USING btree ("workspace_id","knowledge_index_id");
