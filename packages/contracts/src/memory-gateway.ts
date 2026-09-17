import type { MemoryNamespaceId } from "./ids.js";
import type { JsonValue } from "./json-value.js";

export const MEMORY_BINDING_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const MEMORY_ACCESS_MODES = ["READ_ONLY", "READ_WRITE"] as const;

export type MemoryAccessMode = (typeof MEMORY_ACCESS_MODES)[number];

export interface MemoryNamespaceBinding {
  readonly namespaceId: MemoryNamespaceId;
  readonly access: MemoryAccessMode;
}

export const MEMORY_ERROR_CODES = {
  MEMORY_BINDING_NOT_FOUND: "MEMORY_BINDING_NOT_FOUND",
  MEMORY_PERMISSION_DENIED: "MEMORY_PERMISSION_DENIED",
  MEMORY_KEY_NOT_FOUND: "MEMORY_KEY_NOT_FOUND",
  MEMORY_CONFLICT: "MEMORY_CONFLICT",
  MEMORY_INVALID_VALUE: "MEMORY_INVALID_VALUE",
  MEMORY_UNAVAILABLE: "MEMORY_UNAVAILABLE",
  MEMORY_CANCELLED: "MEMORY_CANCELLED",
  MEMORY_TIMEOUT: "MEMORY_TIMEOUT",
} as const;

export type MemoryErrorCode =
  (typeof MEMORY_ERROR_CODES)[keyof typeof MEMORY_ERROR_CODES];

export function isMemoryBindingName(value: string): boolean {
  return MEMORY_BINDING_NAME_PATTERN.test(value);
}

export function isMemoryAccessMode(value: string): value is MemoryAccessMode {
  return (MEMORY_ACCESS_MODES as readonly string[]).includes(value);
}

export function isMemoryErrorCode(value: string): value is MemoryErrorCode {
  return (Object.values(MEMORY_ERROR_CODES) as readonly string[]).includes(
    value,
  );
}

export interface MemoryGetRequest {
  readonly bindingName: string;
  readonly key: string;
}

export interface MemoryRecordView {
  readonly key: string;
  readonly value: JsonValue;
  readonly revision: number;
}

export interface MemorySetRequest {
  readonly bindingName: string;
  readonly key: string;
  readonly value: JsonValue;
  readonly expectedRevision?: number;
}

export interface MemoryDeleteRequest {
  readonly bindingName: string;
  readonly key: string;
  readonly expectedRevision?: number;
}

export interface MemoryListRequest {
  readonly bindingName: string;
  readonly prefix?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface MemoryListResult {
  readonly items: readonly MemoryRecordView[];
  readonly nextCursor?: string;
}

export interface MemoryAuthorization {
  readonly workspaceId: string;
  readonly memoryNamespaceBindings: Readonly<
    Record<string, MemoryNamespaceBinding>
  >;
  readonly allowPersistentMutation: boolean;
}

export interface MemoryGateway {
  get(
    request: MemoryGetRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryRecordView>;
  set(
    request: MemorySetRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryRecordView>;
  delete(
    request: MemoryDeleteRequest,
    authorization: MemoryAuthorization,
  ): Promise<void>;
  list(
    request: MemoryListRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryListResult>;
}
