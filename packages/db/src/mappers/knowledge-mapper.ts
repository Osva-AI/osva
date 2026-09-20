import type {
  ArtifactId,
  JsonObject,
  KnowledgeChunkId,
  KnowledgeErrorCode,
  KnowledgeIndexId,
  KnowledgeSourceId,
  WorkspaceId,
} from "@osva/contracts";

import { KnowledgeChunk, KnowledgeIndex, KnowledgeSource } from "@osva/domain";

import type { knowledgeChunks } from "../schema/knowledge-chunks.js";
import type { knowledgeIndexes } from "../schema/knowledge-indexes.js";
import type { knowledgeSources } from "../schema/knowledge-sources.js";

export type KnowledgeSourceRow = typeof knowledgeSources.$inferSelect;
export type KnowledgeSourceInsertRow = typeof knowledgeSources.$inferInsert;
export type KnowledgeIndexRow = typeof knowledgeIndexes.$inferSelect;
export type KnowledgeIndexInsertRow = typeof knowledgeIndexes.$inferInsert;
export type KnowledgeChunkRow = typeof knowledgeChunks.$inferSelect;
export type KnowledgeChunkInsertRow = typeof knowledgeChunks.$inferInsert;

export function knowledgeSourceToRow(
  source: KnowledgeSource,
): KnowledgeSourceInsertRow {
  return {
    id: source.id,
    workspaceId: source.workspaceId,
    key: source.key,
    name: source.name,
    artifactId: source.artifactId,
    attributes: source.attributes,
    idempotencyKey: source.idempotencyKey ?? null,
    createdAt: source.createdAt,
  };
}

export function knowledgeSourceFromRow(
  row: KnowledgeSourceRow,
): KnowledgeSource {
  return KnowledgeSource.rehydrate({
    id: row.id as KnowledgeSourceId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    name: row.name,
    artifactId: row.artifactId as ArtifactId,
    attributes: row.attributes as JsonObject,
    idempotencyKey: row.idempotencyKey ?? undefined,
    createdAt: row.createdAt,
  });
}

export function knowledgeIndexToRow(
  index: KnowledgeIndex,
): KnowledgeIndexInsertRow {
  return {
    id: index.id,
    workspaceId: index.workspaceId,
    knowledgeSourceId: index.knowledgeSourceId,
    status: index.status,
    parserKey: index.parserKey,
    parserVersion: index.parserVersion,
    chunkerKey: index.chunkerKey,
    chunkerVersion: index.chunkerVersion,
    chunkSize: index.chunkSize,
    chunkOverlap: index.chunkOverlap,
    embeddingProvider: index.embeddingProvider,
    embeddingModel: index.embeddingModel,
    embeddingDimensions: index.embeddingDimensions,
    distanceMetric: index.distanceMetric,
    pipelineFingerprint: index.pipelineFingerprint,
    extractedArtifactId: index.extractedArtifactId ?? null,
    attemptCount: index.attemptCount,
    leaseToken: index.leaseToken ?? null,
    leaseExpiresAt: index.leaseExpiresAt ?? null,
    chunkCount: index.chunkCount ?? null,
    embeddedChunkCount: index.embeddedChunkCount ?? null,
    lastErrorCode: index.lastErrorCode ?? null,
    lastErrorMessage: index.lastErrorMessage ?? null,
    idempotencyKey: index.idempotencyKey ?? null,
    createdAt: index.createdAt,
    updatedAt: index.updatedAt,
    readyAt: index.readyAt ?? null,
  };
}

function toInstant(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toOptionalInstant(
  value: Date | string | null | undefined,
): Date | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return toInstant(value);
}

export function knowledgeIndexFromSqlRow(
  row: Record<string, unknown>,
): KnowledgeIndex {
  return knowledgeIndexFromRow({
    id: row.id,
    workspaceId: row.workspace_id,
    knowledgeSourceId: row.knowledge_source_id,
    status: row.status,
    parserKey: row.parser_key,
    parserVersion: row.parser_version,
    chunkerKey: row.chunker_key,
    chunkerVersion: row.chunker_version,
    chunkSize: row.chunk_size,
    chunkOverlap: row.chunk_overlap,
    embeddingProvider: row.embedding_provider,
    embeddingModel: row.embedding_model,
    embeddingDimensions: row.embedding_dimensions,
    distanceMetric: row.distance_metric,
    pipelineFingerprint: row.pipeline_fingerprint,
    extractedArtifactId: row.extracted_artifact_id,
    attemptCount: row.attempt_count,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    chunkCount: row.chunk_count,
    embeddedChunkCount: row.embedded_chunk_count,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readyAt: row.ready_at,
  } as KnowledgeIndexRow);
}

export function knowledgeIndexFromRow(row: KnowledgeIndexRow): KnowledgeIndex {
  return KnowledgeIndex.rehydrate({
    id: row.id as KnowledgeIndexId,
    workspaceId: row.workspaceId as WorkspaceId,
    knowledgeSourceId: row.knowledgeSourceId as KnowledgeSourceId,
    status: row.status as KnowledgeIndex["status"],
    parserKey: row.parserKey,
    parserVersion: row.parserVersion,
    chunkerKey: row.chunkerKey,
    chunkerVersion: row.chunkerVersion,
    chunkSize: row.chunkSize,
    chunkOverlap: row.chunkOverlap,
    embeddingProvider: row.embeddingProvider,
    embeddingModel: row.embeddingModel,
    embeddingDimensions: row.embeddingDimensions,
    distanceMetric: row.distanceMetric as KnowledgeIndex["distanceMetric"],
    pipelineFingerprint: row.pipelineFingerprint,
    extractedArtifactId: (row.extractedArtifactId ?? undefined) as
      ArtifactId | undefined,
    attemptCount: row.attemptCount,
    leaseToken: row.leaseToken ?? undefined,
    leaseExpiresAt: toOptionalInstant(
      row.leaseExpiresAt as Date | string | null | undefined,
    ),
    chunkCount: row.chunkCount ?? undefined,
    embeddedChunkCount: row.embeddedChunkCount ?? undefined,
    lastErrorCode: (row.lastErrorCode ?? undefined) as
      KnowledgeErrorCode | undefined,
    lastErrorMessage: row.lastErrorMessage ?? undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    createdAt: toInstant(row.createdAt as Date | string),
    updatedAt: toInstant(row.updatedAt as Date | string),
    readyAt: toOptionalInstant(row.readyAt as Date | string | null | undefined),
  });
}

export function knowledgeChunkToRow(
  chunk: KnowledgeChunk,
): KnowledgeChunkInsertRow {
  return {
    id: chunk.id,
    workspaceId: chunk.workspaceId,
    knowledgeIndexId: chunk.knowledgeIndexId,
    ordinal: chunk.ordinal,
    text: chunk.text,
    textSha256: chunk.textSha256,
    location: (chunk.location as Record<string, unknown> | undefined) ?? null,
    createdAt: chunk.createdAt,
  };
}

export function knowledgeChunkFromRow(row: KnowledgeChunkRow): KnowledgeChunk {
  return KnowledgeChunk.rehydrate({
    id: row.id as KnowledgeChunkId,
    workspaceId: row.workspaceId as WorkspaceId,
    knowledgeIndexId: row.knowledgeIndexId as KnowledgeIndexId,
    ordinal: row.ordinal,
    text: row.text,
    textSha256: row.textSha256,
    location:
      row.location === null || row.location === undefined
        ? undefined
        : (row.location as KnowledgeChunk["location"]),
    createdAt: row.createdAt,
  });
}
