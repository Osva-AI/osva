import type {
  JsonObject,
  KnowledgeChunkId,
  KnowledgeIndexId,
  WorkspaceId,
} from "@osva/contracts";

export interface VectorMatch {
  readonly knowledgeChunkId: KnowledgeChunkId;
  readonly distance: number;
}

export interface VectorStoreQuery {
  readonly workspaceId: WorkspaceId;
  readonly knowledgeIndexIds: readonly KnowledgeIndexId[];
  readonly queryVector: readonly number[];
  readonly topK: number;
  readonly filter?: JsonObject;
}

export interface VectorStoreUpsertItem {
  readonly workspaceId: WorkspaceId;
  readonly knowledgeIndexId: KnowledgeIndexId;
  readonly knowledgeChunkId: KnowledgeChunkId;
  readonly embedding: readonly number[];
}

export interface VectorStore {
  upsert(items: readonly VectorStoreUpsertItem[]): Promise<void>;
  query(query: VectorStoreQuery): Promise<readonly VectorMatch[]>;
  countForIndex(knowledgeIndexId: KnowledgeIndexId): Promise<number>;
}
