import type { MemoryNamespaceId, WorkspaceId } from "./ids.js";
import type { JsonValue } from "./json-value.js";

export interface MemoryNamespaceResourceV1 {
  readonly id: MemoryNamespaceId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryNamespaceListResourceV1 {
  readonly items: readonly MemoryNamespaceResourceV1[];
}

export interface CreateMemoryNamespaceRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface MemoryRecordResourceV1 {
  readonly key: string;
  readonly value: JsonValue;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryRecordListResourceV1 {
  readonly items: readonly MemoryRecordResourceV1[];
  readonly nextCursor?: string;
}

export interface ListMemoryRecordsQueryV1 {
  readonly prefix?: string;
  readonly limit?: number;
  readonly cursor?: string;
}
