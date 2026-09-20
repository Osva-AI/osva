import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { artifacts } from "./artifacts.js";
import { knowledgeSources } from "./knowledge-sources.js";
import { workspaces } from "./workspaces.js";
import { PERSISTED_KNOWLEDGE_INDEX_STATES } from "./states.js";
import { sqlTextInList } from "./sql.js";

export const knowledgeIndexes = pgTable(
  "knowledge_indexes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    knowledgeSourceId: text("knowledge_source_id").notNull(),
    status: text("status").notNull(),
    parserKey: text("parser_key").notNull(),
    parserVersion: text("parser_version").notNull(),
    chunkerKey: text("chunker_key").notNull(),
    chunkerVersion: text("chunker_version").notNull(),
    chunkSize: integer("chunk_size").notNull(),
    chunkOverlap: integer("chunk_overlap").notNull(),
    embeddingProvider: text("embedding_provider").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    embeddingDimensions: integer("embedding_dimensions").notNull(),
    distanceMetric: text("distance_metric").notNull(),
    pipelineFingerprint: text("pipeline_fingerprint").notNull(),
    extractedArtifactId: text("extracted_artifact_id"),
    attemptCount: integer("attempt_count").notNull(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    chunkCount: integer("chunk_count"),
    embeddedChunkCount: integer("embedded_chunk_count"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    readyAt: timestamp("ready_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "knowledge_indexes_workspace_id_workspaces_id_fk",
    }),
    foreignKey({
      columns: [table.knowledgeSourceId],
      foreignColumns: [knowledgeSources.id],
      name: "knowledge_indexes_knowledge_source_id_fk",
    }),
    foreignKey({
      columns: [table.extractedArtifactId],
      foreignColumns: [artifacts.id],
      name: "knowledge_indexes_extracted_artifact_id_fk",
    }),
    check(
      "knowledge_indexes_status_valid",
      sql`${table.status} in (${sqlTextInList(PERSISTED_KNOWLEDGE_INDEX_STATES)})`,
    ),
    check("knowledge_indexes_chunk_size_positive", sql`${table.chunkSize} > 0`),
    check(
      "knowledge_indexes_chunk_overlap_non_negative",
      sql`${table.chunkOverlap} >= 0`,
    ),
    check(
      "knowledge_indexes_embedding_dimensions_positive",
      sql`${table.embeddingDimensions} > 0`,
    ),
    check(
      "knowledge_indexes_attempt_count_non_negative",
      sql`${table.attemptCount} >= 0`,
    ),
    uniqueIndex("knowledge_indexes_workspace_id_idempotency_key_unique")
      .on(table.workspaceId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("knowledge_indexes_workspace_id_source_id_created_at_id_idx").on(
      table.workspaceId,
      table.knowledgeSourceId,
      table.createdAt,
      table.id,
    ),
    index("knowledge_indexes_status_lease_expires_at_idx").on(
      table.status,
      table.leaseExpiresAt,
    ),
  ],
);
