import type { MemoryNamespaceId, WorkspaceId } from "@osva/contracts";
import {
  DuplicateMemoryNamespaceKeyError,
  MEMORY_RECORD_INITIAL_REVISION,
  MemoryRecord,
  MemoryRecordConflictError,
  MemoryRecordNotFoundError,
  type DeleteMemoryRecordInput,
  type ListMemoryRecordsQuery,
  type ListMemoryRecordsResult,
  type MemoryNamespace,
  type MemoryNamespaceRepository,
  type SetMemoryRecordInput,
} from "@osva/domain";
import { and, asc, eq, gt, like } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  memoryNamespaceFromRow,
  memoryNamespaceToRow,
} from "../mappers/memory-namespace-mapper.js";
import {
  memoryRecordFromRow,
  memoryRecordToRow,
} from "../mappers/memory-record-mapper.js";
import {
  POSTGRES_UNIQUE_VIOLATION,
  mapDatabaseError,
  postgresConstraintName,
  postgresErrorCode,
} from "../postgres-errors.js";
import { memoryNamespaces } from "../schema/memory-namespaces.js";
import { memoryRecords } from "../schema/memory-records.js";

export class PostgresMemoryNamespaceRepository implements MemoryNamespaceRepository {
  constructor(private readonly database: Database) {}

  async saveNamespace(namespace: MemoryNamespace): Promise<void> {
    const row = memoryNamespaceToRow(namespace);

    try {
      await this.database.db
        .insert(memoryNamespaces)
        .values(row)
        .onConflictDoUpdate({
          target: memoryNamespaces.id,
          set: {
            workspaceId: row.workspaceId,
            key: row.key,
            name: row.name,
            description: row.description,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        });
    } catch (error) {
      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) ===
          "memory_namespaces_workspace_id_key_unique"
      ) {
        throw new DuplicateMemoryNamespaceKeyError(
          namespace.workspaceId,
          namespace.key,
        );
      }

      throw mapDatabaseError(error, {
        memory_namespaces_workspace_id_key_unique: `Memory namespace key '${namespace.key}' already exists in workspace '${namespace.workspaceId}'.`,
      });
    }
  }

  async findNamespaceById(
    id: MemoryNamespaceId,
  ): Promise<MemoryNamespace | null> {
    const [row] = await this.database.db
      .select()
      .from(memoryNamespaces)
      .where(eq(memoryNamespaces.id, id))
      .limit(1);

    return row === undefined ? null : memoryNamespaceFromRow(row);
  }

  async findNamespaceByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: MemoryNamespaceId,
  ): Promise<MemoryNamespace | null> {
    const [row] = await this.database.db
      .select()
      .from(memoryNamespaces)
      .where(
        and(
          eq(memoryNamespaces.id, id),
          eq(memoryNamespaces.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return row === undefined ? null : memoryNamespaceFromRow(row);
  }

  async listNamespacesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly MemoryNamespace[]> {
    const rows = await this.database.db
      .select()
      .from(memoryNamespaces)
      .where(eq(memoryNamespaces.workspaceId, workspaceId))
      .orderBy(asc(memoryNamespaces.createdAt), asc(memoryNamespaces.id));

    return rows.map(memoryNamespaceFromRow);
  }

  async findNamespaceByWorkspaceAndKey(
    workspaceId: WorkspaceId,
    key: string,
  ): Promise<MemoryNamespace | null> {
    const [row] = await this.database.db
      .select()
      .from(memoryNamespaces)
      .where(
        and(
          eq(memoryNamespaces.workspaceId, workspaceId),
          eq(memoryNamespaces.key, key),
        ),
      )
      .limit(1);

    return row === undefined ? null : memoryNamespaceFromRow(row);
  }

  async getRecord(
    namespaceId: MemoryNamespaceId,
    key: string,
  ): Promise<MemoryRecord | null> {
    const [row] = await this.database.db
      .select()
      .from(memoryRecords)
      .where(
        and(
          eq(memoryRecords.namespaceId, namespaceId),
          eq(memoryRecords.key, key),
        ),
      )
      .limit(1);

    return row === undefined ? null : memoryRecordFromRow(row);
  }

  async setRecord(input: SetMemoryRecordInput): Promise<MemoryRecord> {
    return this.database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.namespaceId, input.namespaceId),
            eq(memoryRecords.key, input.key),
          ),
        )
        .for("update")
        .limit(1);

      if (existing === undefined) {
        if (input.expectedRevision !== undefined) {
          throw new MemoryRecordConflictError(
            input.namespaceId,
            input.key,
            input.expectedRevision,
            undefined,
          );
        }

        const record = MemoryRecord.create({
          namespaceId: input.namespaceId,
          key: input.key,
          value: input.value,
          revision: MEMORY_RECORD_INITIAL_REVISION,
          createdAt: input.updatedAt,
          updatedAt: input.updatedAt,
        });

        await tx.insert(memoryRecords).values(memoryRecordToRow(record));
        return record;
      }

      if (
        input.expectedRevision !== undefined &&
        existing.revision !== input.expectedRevision
      ) {
        throw new MemoryRecordConflictError(
          input.namespaceId,
          input.key,
          input.expectedRevision,
          existing.revision,
        );
      }

      const nextRevision = existing.revision + 1;
      const [updated] = await tx
        .update(memoryRecords)
        .set({
          value: input.value,
          revision: nextRevision,
          updatedAt: input.updatedAt,
        })
        .where(
          and(
            eq(memoryRecords.namespaceId, input.namespaceId),
            eq(memoryRecords.key, input.key),
            eq(memoryRecords.revision, existing.revision),
          ),
        )
        .returning();

      if (updated === undefined) {
        throw new MemoryRecordConflictError(
          input.namespaceId,
          input.key,
          input.expectedRevision ?? existing.revision,
          existing.revision,
        );
      }

      return memoryRecordFromRow(updated);
    });
  }

  async deleteRecord(input: DeleteMemoryRecordInput): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.namespaceId, input.namespaceId),
            eq(memoryRecords.key, input.key),
          ),
        )
        .for("update")
        .limit(1);

      if (existing === undefined) {
        throw new MemoryRecordNotFoundError(input.namespaceId, input.key);
      }

      if (
        input.expectedRevision !== undefined &&
        existing.revision !== input.expectedRevision
      ) {
        throw new MemoryRecordConflictError(
          input.namespaceId,
          input.key,
          input.expectedRevision,
          existing.revision,
        );
      }

      const deleted = await tx
        .delete(memoryRecords)
        .where(
          and(
            eq(memoryRecords.namespaceId, input.namespaceId),
            eq(memoryRecords.key, input.key),
            eq(memoryRecords.revision, existing.revision),
          ),
        )
        .returning({ key: memoryRecords.key });

      if (deleted.length === 0) {
        throw new MemoryRecordConflictError(
          input.namespaceId,
          input.key,
          input.expectedRevision ?? existing.revision,
          existing.revision,
        );
      }
    });
  }

  async listRecords(
    query: ListMemoryRecordsQuery,
  ): Promise<ListMemoryRecordsResult> {
    const conditions = [eq(memoryRecords.namespaceId, query.namespaceId)];

    if (query.prefix !== undefined && query.prefix.length > 0) {
      conditions.push(like(memoryRecords.key, `${query.prefix}%`));
    }

    if (query.cursor !== undefined) {
      conditions.push(gt(memoryRecords.key, query.cursor));
    }

    const rows = await this.database.db
      .select()
      .from(memoryRecords)
      .where(and(...conditions))
      .orderBy(asc(memoryRecords.key))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      records: page.map(memoryRecordFromRow),
      nextCursor: hasMore && last !== undefined ? last.key : undefined,
    };
  }
}
