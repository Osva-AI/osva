import type {
  KnowledgeChunkId,
  KnowledgeIndexId,
  KnowledgeSourceId,
  WorkspaceId,
} from "@osva/contracts";

import type { KnowledgeChunk } from "../knowledge-chunk.js";
import type { KnowledgeIndex } from "../knowledge-index.js";
import type { KnowledgeSource } from "../knowledge-source.js";

export const DEFAULT_KNOWLEDGE_SOURCE_LIST_LIMIT = 50;
export const MAX_KNOWLEDGE_SOURCE_LIST_LIMIT = 100;
export const DEFAULT_KNOWLEDGE_INDEX_LIST_LIMIT = 50;
export const MAX_KNOWLEDGE_INDEX_LIST_LIMIT = 100;

export interface ListKnowledgeSourcesQuery {
  readonly workspaceId: WorkspaceId;
  readonly limit: number;
  readonly cursor?: {
    readonly createdAt: Date;
    readonly id: KnowledgeSourceId;
  };
}

export interface ListKnowledgeSourcesResult {
  readonly sources: readonly KnowledgeSource[];
  readonly nextCursor?: {
    readonly createdAt: Date;
    readonly id: KnowledgeSourceId;
  };
}

export interface ListKnowledgeIndexesQuery {
  readonly workspaceId: WorkspaceId;
  readonly knowledgeSourceId: KnowledgeSourceId;
  readonly limit: number;
  readonly cursor?: { readonly createdAt: Date; readonly id: KnowledgeIndexId };
}

export interface ListKnowledgeIndexesResult {
  readonly indexes: readonly KnowledgeIndex[];
  readonly nextCursor?: {
    readonly createdAt: Date;
    readonly id: KnowledgeIndexId;
  };
}

export interface ClaimKnowledgeIndexLeaseInput {
  readonly knowledgeIndexId: KnowledgeIndexId;
  readonly workspaceId: WorkspaceId;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
  readonly now: Date;
}

export interface KnowledgeRepository {
  saveSource(source: KnowledgeSource): Promise<void>;
  findSourceById(id: KnowledgeSourceId): Promise<KnowledgeSource | null>;
  findSourceByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: KnowledgeSourceId,
  ): Promise<KnowledgeSource | null>;
  findSourceByWorkspaceKey(
    workspaceId: WorkspaceId,
    key: string,
  ): Promise<KnowledgeSource | null>;
  findSourceByWorkspaceIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<KnowledgeSource | null>;
  listSources(
    query: ListKnowledgeSourcesQuery,
  ): Promise<ListKnowledgeSourcesResult>;

  saveIndex(index: KnowledgeIndex): Promise<void>;
  updateIndex(index: KnowledgeIndex): Promise<void>;
  findIndexById(id: KnowledgeIndexId): Promise<KnowledgeIndex | null>;
  findIndexByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: KnowledgeIndexId,
  ): Promise<KnowledgeIndex | null>;
  findIndexByWorkspaceIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<KnowledgeIndex | null>;
  listIndexesBySource(
    query: ListKnowledgeIndexesQuery,
  ): Promise<ListKnowledgeIndexesResult>;
  claimIndexLease(
    input: ClaimKnowledgeIndexLeaseInput,
  ): Promise<KnowledgeIndex | null>;

  saveChunk(chunk: KnowledgeChunk): Promise<void>;
  findChunkByIndexOrdinal(
    knowledgeIndexId: KnowledgeIndexId,
    ordinal: number,
  ): Promise<KnowledgeChunk | null>;
  listChunksByIndex(
    knowledgeIndexId: KnowledgeIndexId,
  ): Promise<readonly KnowledgeChunk[]>;
  findChunksByIds(
    chunkIds: readonly KnowledgeChunkId[],
    workspaceId: WorkspaceId,
  ): Promise<readonly KnowledgeChunk[]>;
  countChunksForIndex(knowledgeIndexId: KnowledgeIndexId): Promise<number>;
}

export interface KnowledgeIndexIdempotencyRecord {
  readonly workspaceId: WorkspaceId;
  readonly knowledgeSourceId: KnowledgeSourceId;
  readonly pipelineFingerprint: string;
  readonly knowledgeIndexId: KnowledgeIndexId;
}
