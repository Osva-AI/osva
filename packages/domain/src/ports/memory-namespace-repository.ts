import type {
  JsonValue,
  MemoryNamespaceId,
  WorkspaceId,
} from "@osva/contracts";

import type { MemoryNamespace } from "../memory-namespace.js";
import type { MemoryRecord } from "../memory-record.js";

export const DEFAULT_MEMORY_RECORD_LIST_LIMIT = 50;
export const MAX_MEMORY_RECORD_LIST_LIMIT = 100;

export interface SetMemoryRecordInput {
  readonly namespaceId: MemoryNamespaceId;
  readonly key: string;
  readonly value: JsonValue;
  readonly expectedRevision?: number;
  readonly updatedAt: Date;
}

export interface DeleteMemoryRecordInput {
  readonly namespaceId: MemoryNamespaceId;
  readonly key: string;
  readonly expectedRevision?: number;
}

export interface ListMemoryRecordsQuery {
  readonly namespaceId: MemoryNamespaceId;
  readonly prefix?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListMemoryRecordsResult {
  readonly records: readonly MemoryRecord[];
  readonly nextCursor?: string;
}

export interface MemoryNamespaceRepository {
  saveNamespace(namespace: MemoryNamespace): Promise<void>;
  findNamespaceById(id: MemoryNamespaceId): Promise<MemoryNamespace | null>;
  listNamespacesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly MemoryNamespace[]>;
  findNamespaceByWorkspaceAndKey(
    workspaceId: WorkspaceId,
    key: string,
  ): Promise<MemoryNamespace | null>;
  getRecord(
    namespaceId: MemoryNamespaceId,
    key: string,
  ): Promise<MemoryRecord | null>;
  setRecord(input: SetMemoryRecordInput): Promise<MemoryRecord>;
  deleteRecord(input: DeleteMemoryRecordInput): Promise<void>;
  listRecords(query: ListMemoryRecordsQuery): Promise<ListMemoryRecordsResult>;
}
