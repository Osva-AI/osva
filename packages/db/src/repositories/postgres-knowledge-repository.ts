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
  type ClaimKnowledgeIndexLeaseInput,
  type KnowledgeRepository,
  type ListKnowledgeIndexesQuery,
  type ListKnowledgeIndexesResult,
  type ListKnowledgeSourcesQuery,
  type ListKnowledgeSourcesResult,
} from "@osva/domain";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  knowledgeChunkFromRow,
  knowledgeChunkToRow,
  knowledgeIndexFromRow,
  knowledgeIndexFromSqlRow,
  knowledgeIndexToRow,
  knowledgeSourceFromRow,
  knowledgeSourceToRow,
} from "../mappers/knowledge-mapper.js";
import { mapDatabaseError } from "../postgres-errors.js";
import { knowledgeChunks } from "../schema/knowledge-chunks.js";
import { knowledgeIndexes } from "../schema/knowledge-indexes.js";
import { knowledgeSources } from "../schema/knowledge-sources.js";

export class PostgresKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly database: Database) {}

  async saveSource(source: KnowledgeSource): Promise<void> {
    try {
      await this.database.db
        .insert(knowledgeSources)
        .values(knowledgeSourceToRow(source));
    } catch (error) {
      throw mapDatabaseError(error, {
        knowledge_sources_workspace_id_key_unique:
          "Knowledge source key already exists in workspace.",
        knowledge_sources_workspace_id_idempotency_key_unique:
          "Knowledge source idempotency key already exists in workspace.",
      });
    }
  }

  async findSourceById(id: KnowledgeSourceId): Promise<KnowledgeSource | null> {
    const [row] = await this.database.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, id))
      .limit(1);
    return row === undefined ? null : knowledgeSourceFromRow(row);
  }

  async findSourceByWorkspaceKey(
    workspaceId: WorkspaceId,
    key: string,
  ): Promise<KnowledgeSource | null> {
    const [row] = await this.database.db
      .select()
      .from(knowledgeSources)
      .where(
        and(
          eq(knowledgeSources.workspaceId, workspaceId),
          eq(knowledgeSources.key, key),
        ),
      )
      .limit(1);
    return row === undefined ? null : knowledgeSourceFromRow(row);
  }

  async findSourceByWorkspaceIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<KnowledgeSource | null> {
    const [row] = await this.database.db
      .select()
      .from(knowledgeSources)
      .where(
        and(
          eq(knowledgeSources.workspaceId, workspaceId),
          eq(knowledgeSources.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row === undefined ? null : knowledgeSourceFromRow(row);
  }

  async listSources(
    query: ListKnowledgeSourcesQuery,
  ): Promise<ListKnowledgeSourcesResult> {
    const conditions = [eq(knowledgeSources.workspaceId, query.workspaceId)];
    if (query.cursor !== undefined) {
      const cursorCondition = or(
        lt(knowledgeSources.createdAt, query.cursor.createdAt),
        and(
          eq(knowledgeSources.createdAt, query.cursor.createdAt),
          lt(knowledgeSources.id, query.cursor.id),
        ),
      );
      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }

    const rows = await this.database.db
      .select()
      .from(knowledgeSources)
      .where(and(...conditions))
      .orderBy(desc(knowledgeSources.createdAt), desc(knowledgeSources.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const mapped = page.map(knowledgeSourceFromRow);
    const last = mapped[mapped.length - 1];
    return {
      sources: mapped,
      nextCursor:
        hasMore && last !== undefined
          ? { createdAt: last.createdAt, id: last.id }
          : undefined,
    };
  }

  async saveIndex(index: KnowledgeIndex): Promise<void> {
    try {
      await this.database.db
        .insert(knowledgeIndexes)
        .values(knowledgeIndexToRow(index));
    } catch (error) {
      throw mapDatabaseError(error, {
        knowledge_indexes_workspace_id_idempotency_key_unique:
          "Knowledge index idempotency key already exists in workspace.",
      });
    }
  }

  async updateIndex(index: KnowledgeIndex): Promise<void> {
    await this.database.db
      .update(knowledgeIndexes)
      .set(knowledgeIndexToRow(index))
      .where(eq(knowledgeIndexes.id, index.id));
  }

  async findIndexById(id: KnowledgeIndexId): Promise<KnowledgeIndex | null> {
    const [row] = await this.database.db
      .select()
      .from(knowledgeIndexes)
      .where(eq(knowledgeIndexes.id, id))
      .limit(1);
    return row === undefined ? null : knowledgeIndexFromRow(row);
  }

  async findIndexByWorkspaceIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<KnowledgeIndex | null> {
    const [row] = await this.database.db
      .select()
      .from(knowledgeIndexes)
      .where(
        and(
          eq(knowledgeIndexes.workspaceId, workspaceId),
          eq(knowledgeIndexes.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row === undefined ? null : knowledgeIndexFromRow(row);
  }

  async listIndexesBySource(
    query: ListKnowledgeIndexesQuery,
  ): Promise<ListKnowledgeIndexesResult> {
    const conditions = [
      eq(knowledgeIndexes.workspaceId, query.workspaceId),
      eq(knowledgeIndexes.knowledgeSourceId, query.knowledgeSourceId),
    ];
    if (query.cursor !== undefined) {
      const cursorCondition = or(
        lt(knowledgeIndexes.createdAt, query.cursor.createdAt),
        and(
          eq(knowledgeIndexes.createdAt, query.cursor.createdAt),
          lt(knowledgeIndexes.id, query.cursor.id),
        ),
      );
      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }

    const rows = await this.database.db
      .select()
      .from(knowledgeIndexes)
      .where(and(...conditions))
      .orderBy(desc(knowledgeIndexes.createdAt), desc(knowledgeIndexes.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const mapped = page.map(knowledgeIndexFromRow);
    const last = mapped[mapped.length - 1];
    return {
      indexes: mapped,
      nextCursor:
        hasMore && last !== undefined
          ? { createdAt: last.createdAt, id: last.id }
          : undefined,
    };
  }

  async claimIndexLease(
    input: ClaimKnowledgeIndexLeaseInput,
  ): Promise<KnowledgeIndex | null> {
    const leaseExpiresAt = input.leaseExpiresAt.toISOString();
    const now = input.now.toISOString();
    const rows = await this.database.sql<
      (typeof knowledgeIndexes.$inferSelect)[]
    >`
      update knowledge_indexes
      set
        status = 'RUNNING',
        lease_token = ${input.leaseToken},
        lease_expires_at = ${leaseExpiresAt},
        attempt_count = attempt_count + 1,
        updated_at = ${now},
        last_error_code = null,
        last_error_message = null
      where id = ${input.knowledgeIndexId}
        and workspace_id = ${input.workspaceId}
        and (
          status = 'PENDING'
          or (
            status = 'RUNNING'
            and lease_expires_at is not null
            and lease_expires_at < ${now}
          )
        )
      returning *
    `;

    const row = rows[0];
    return row === undefined
      ? null
      : knowledgeIndexFromSqlRow(row as Record<string, unknown>);
  }

  async saveChunk(chunk: KnowledgeChunk): Promise<void> {
    try {
      await this.database.db
        .insert(knowledgeChunks)
        .values(knowledgeChunkToRow(chunk));
    } catch (error) {
      throw mapDatabaseError(error, {
        knowledge_chunks_index_id_ordinal_unique:
          "Knowledge chunk ordinal already exists for index.",
      });
    }
  }

  async findChunkByIndexOrdinal(
    knowledgeIndexId: KnowledgeIndexId,
    ordinal: number,
  ): Promise<KnowledgeChunk | null> {
    const [row] = await this.database.db
      .select()
      .from(knowledgeChunks)
      .where(
        and(
          eq(knowledgeChunks.knowledgeIndexId, knowledgeIndexId),
          eq(knowledgeChunks.ordinal, ordinal),
        ),
      )
      .limit(1);
    return row === undefined ? null : knowledgeChunkFromRow(row);
  }

  async listChunksByIndex(
    knowledgeIndexId: KnowledgeIndexId,
  ): Promise<readonly KnowledgeChunk[]> {
    const rows = await this.database.db
      .select()
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.knowledgeIndexId, knowledgeIndexId))
      .orderBy(knowledgeChunks.ordinal);
    return rows.map(knowledgeChunkFromRow);
  }

  async findChunksByIds(
    chunkIds: readonly KnowledgeChunkId[],
    workspaceId: WorkspaceId,
  ): Promise<readonly KnowledgeChunk[]> {
    if (chunkIds.length === 0) {
      return [];
    }

    const rows = await this.database.db
      .select()
      .from(knowledgeChunks)
      .where(
        and(
          inArray(knowledgeChunks.id, [...chunkIds]),
          eq(knowledgeChunks.workspaceId, workspaceId),
        ),
      );
    return rows.map(knowledgeChunkFromRow);
  }

  async countChunksForIndex(
    knowledgeIndexId: KnowledgeIndexId,
  ): Promise<number> {
    const rows = await this.database.db
      .select({ id: knowledgeChunks.id })
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.knowledgeIndexId, knowledgeIndexId));
    return rows.length;
  }
}
