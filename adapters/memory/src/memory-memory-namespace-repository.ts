import type { MemoryNamespaceId, WorkspaceId } from "@osva/contracts";
import {
  DuplicateMemoryNamespaceKeyError,
  MEMORY_RECORD_INITIAL_REVISION,
  MemoryNamespace,
  MemoryRecord,
  MemoryRecordConflictError,
  MemoryRecordNotFoundError,
  type DeleteMemoryRecordInput,
  type ListMemoryRecordsQuery,
  type ListMemoryRecordsResult,
  type MemoryNamespaceRepository,
  type SetMemoryRecordInput,
} from "@osva/domain";

export class MemoryMemoryNamespaceRepository implements MemoryNamespaceRepository {
  private readonly namespaces = new Map<MemoryNamespaceId, MemoryNamespace>();
  private readonly records = new Map<string, MemoryRecord>();

  async saveNamespace(namespace: MemoryNamespace): Promise<void> {
    for (const existing of this.namespaces.values()) {
      if (
        existing.id !== namespace.id &&
        existing.workspaceId === namespace.workspaceId &&
        existing.key === namespace.key
      ) {
        throw new DuplicateMemoryNamespaceKeyError(
          namespace.workspaceId,
          namespace.key,
        );
      }
    }

    this.namespaces.set(namespace.id, namespace);
  }

  async findNamespaceById(
    id: MemoryNamespaceId,
  ): Promise<MemoryNamespace | null> {
    return this.namespaces.get(id) ?? null;
  }

  async findNamespaceByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: MemoryNamespaceId,
  ): Promise<MemoryNamespace | null> {
    const namespace = this.namespaces.get(id);
    if (namespace === undefined || namespace.workspaceId !== workspaceId) {
      return null;
    }

    return namespace;
  }

  async listNamespacesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly MemoryNamespace[]> {
    return [...this.namespaces.values()]
      .filter((namespace) => namespace.workspaceId === workspaceId)
      .sort((left, right) => {
        const createdDelta =
          left.createdAt.getTime() - right.createdAt.getTime();
        if (createdDelta !== 0) {
          return createdDelta;
        }

        return left.id.localeCompare(right.id);
      });
  }

  async findNamespaceByWorkspaceAndKey(
    workspaceId: WorkspaceId,
    key: string,
  ): Promise<MemoryNamespace | null> {
    for (const namespace of this.namespaces.values()) {
      if (namespace.workspaceId === workspaceId && namespace.key === key) {
        return namespace;
      }
    }

    return null;
  }

  async getRecord(
    namespaceId: MemoryNamespaceId,
    key: string,
  ): Promise<MemoryRecord | null> {
    return this.records.get(recordKey(namespaceId, key)) ?? null;
  }

  async setRecord(input: SetMemoryRecordInput): Promise<MemoryRecord> {
    const key = recordKey(input.namespaceId, input.key);
    const existing = this.records.get(key);

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
      this.records.set(key, record);
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

    const next = MemoryRecord.create({
      namespaceId: input.namespaceId,
      key: input.key,
      value: input.value,
      revision: existing.revision + 1,
      createdAt: existing.createdAt,
      updatedAt: input.updatedAt,
    });
    this.records.set(key, next);
    return next;
  }

  async deleteRecord(input: DeleteMemoryRecordInput): Promise<void> {
    const key = recordKey(input.namespaceId, input.key);
    const existing = this.records.get(key);
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

    this.records.delete(key);
  }

  async listRecords(
    query: ListMemoryRecordsQuery,
  ): Promise<ListMemoryRecordsResult> {
    const prefix = query.prefix ?? "";
    const rows = [...this.records.values()]
      .filter(
        (record) =>
          record.namespaceId === query.namespaceId &&
          record.key.startsWith(prefix) &&
          (query.cursor === undefined || record.key > query.cursor),
      )
      .sort((left, right) => left.key.localeCompare(right.key));

    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];

    return {
      records: page,
      nextCursor:
        rows.length > query.limit && last !== undefined ? last.key : undefined,
    };
  }
}

function recordKey(namespaceId: MemoryNamespaceId, key: string): string {
  return `${namespaceId}:${key}`;
}
