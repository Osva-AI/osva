import type { KnowledgeChunkId, KnowledgeIndexId } from "@osva/contracts";
import type {
  VectorStore,
  VectorStoreQuery,
  VectorStoreUpsertItem,
} from "@osva/domain";
import type { Database } from "@osva/db";

function toPgVectorLiteral(values: readonly number[]): string {
  return `[${values.map((value) => Number(value).toFixed(8)).join(",")}]`;
}

export class PgVectorStore implements VectorStore {
  constructor(private readonly database: Database) {}

  async upsert(items: readonly VectorStoreUpsertItem[]): Promise<void> {
    for (const item of items) {
      const literal = toPgVectorLiteral(item.embedding);
      await this.database.sql`
        insert into knowledge_vectors (
          workspace_id,
          knowledge_index_id,
          knowledge_chunk_id,
          embedding
        ) values (
          ${item.workspaceId},
          ${item.knowledgeIndexId},
          ${item.knowledgeChunkId},
          ${literal}::vector
        )
        on conflict (knowledge_chunk_id) do update
        set
          workspace_id = excluded.workspace_id,
          knowledge_index_id = excluded.knowledge_index_id,
          embedding = excluded.embedding
      `;
    }
  }

  async query(query: VectorStoreQuery) {
    if (query.knowledgeIndexIds.length === 0) {
      return [];
    }

    const vectorLiteral = toPgVectorLiteral(query.queryVector);
    const filterJson = query.filter ? JSON.stringify(query.filter) : null;

    const rows = await this.database.sql<
      { knowledge_chunk_id: string; distance: number }[]
    >`
      select
        kv.knowledge_chunk_id,
        (kv.embedding <=> ${vectorLiteral}::vector) as distance
      from knowledge_vectors kv
      inner join knowledge_chunks kc
        on kc.id = kv.knowledge_chunk_id
      inner join knowledge_indexes ki
        on ki.id = kv.knowledge_index_id
      inner join knowledge_sources ks
        on ks.id = ki.knowledge_source_id
      where kv.workspace_id = ${query.workspaceId}
        and kv.knowledge_index_id = any(${query.knowledgeIndexIds})
        and (
          ${filterJson}::jsonb is null
          or ks.attributes @> ${filterJson}::jsonb
        )
      order by kv.embedding <=> ${vectorLiteral}::vector asc
      limit ${query.topK}
    `;

    return rows.map((row) => ({
      knowledgeChunkId: row.knowledge_chunk_id as KnowledgeChunkId,
      distance: Number(row.distance),
    }));
  }

  async countForIndex(knowledgeIndexId: KnowledgeIndexId): Promise<number> {
    const rows = await this.database.sql<{ count: string }[]>`
      select count(*)::text as count
      from knowledge_vectors
      where knowledge_index_id = ${knowledgeIndexId}
    `;
    return Number.parseInt(rows[0]?.count ?? "0", 10);
  }
}
