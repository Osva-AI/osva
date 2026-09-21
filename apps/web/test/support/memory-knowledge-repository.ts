import type {
  KnowledgeChunkId,
  KnowledgeIndexId,
  KnowledgeSourceId,
  WorkspaceId,
} from "@osva/contracts";
import {
  KnowledgeChunk,
  KnowledgeIndex,
  KnowledgeSource,
  type KnowledgeRepository,
  type ListKnowledgeIndexesQuery,
  type ListKnowledgeIndexesResult,
  type ListKnowledgeSourcesQuery,
  type ListKnowledgeSourcesResult,
} from "@osva/domain";

export class TestMemoryKnowledgeRepository implements KnowledgeRepository {
  private readonly sources = new Map<KnowledgeSourceId, KnowledgeSource>();
  private readonly indexes = new Map<KnowledgeIndexId, KnowledgeIndex>();
  private readonly chunks = new Map<KnowledgeChunkId, KnowledgeChunk>();

  async saveSource(source: KnowledgeSource): Promise<void> {
    this.sources.set(source.id, source);
  }

  async findSourceById(id: KnowledgeSourceId): Promise<KnowledgeSource | null> {
    return this.sources.get(id) ?? null;
  }

  async findSourceByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: KnowledgeSourceId,
  ): Promise<KnowledgeSource | null> {
    const source = this.sources.get(id);
    if (source === undefined || source.workspaceId !== workspaceId) {
      return null;
    }
    return source;
  }

  async findSourceByWorkspaceKey(): Promise<KnowledgeSource | null> {
    return null;
  }

  async findSourceByWorkspaceIdempotencyKey(): Promise<KnowledgeSource | null> {
    return null;
  }

  async listSources(
    query: ListKnowledgeSourcesQuery,
  ): Promise<ListKnowledgeSourcesResult> {
    const sources = [...this.sources.values()]
      .filter((source) => source.workspaceId === query.workspaceId)
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id),
      )
      .slice(0, query.limit);
    return { sources };
  }

  async saveIndex(index: KnowledgeIndex): Promise<void> {
    this.indexes.set(index.id, index);
  }

  async updateIndex(index: KnowledgeIndex): Promise<void> {
    this.indexes.set(index.id, index);
  }

  async findIndexById(id: KnowledgeIndexId): Promise<KnowledgeIndex | null> {
    return this.indexes.get(id) ?? null;
  }

  async findIndexByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: KnowledgeIndexId,
  ): Promise<KnowledgeIndex | null> {
    const index = this.indexes.get(id);
    if (index === undefined || index.workspaceId !== workspaceId) {
      return null;
    }
    return index;
  }

  async findIndexByWorkspaceIdempotencyKey(): Promise<KnowledgeIndex | null> {
    return null;
  }

  async listIndexesBySource(
    query: ListKnowledgeIndexesQuery,
  ): Promise<ListKnowledgeIndexesResult> {
    const indexes = [...this.indexes.values()]
      .filter(
        (index) =>
          index.workspaceId === query.workspaceId &&
          index.knowledgeSourceId === query.knowledgeSourceId,
      )
      .slice(0, query.limit);
    return { indexes };
  }

  async claimIndexLease(): Promise<KnowledgeIndex | null> {
    return null;
  }

  async saveChunk(chunk: KnowledgeChunk): Promise<void> {
    this.chunks.set(chunk.id, chunk);
  }

  async findChunkByIndexOrdinal(): Promise<KnowledgeChunk | null> {
    return null;
  }

  async listChunksByIndex(): Promise<readonly KnowledgeChunk[]> {
    return [];
  }

  async findChunksByIds(): Promise<readonly KnowledgeChunk[]> {
    return [];
  }

  async countChunksForIndex(): Promise<number> {
    return 0;
  }
}
