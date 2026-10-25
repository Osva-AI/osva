import type { ApiKeyId, WorkspaceId } from "@osva-ai/contracts";

import type { ApiKey } from "../api-key.js";
import type { SecurityAuditEvent } from "../security-audit-event.js";

export interface ApiKeyPersistedRecord {
  readonly apiKey: ApiKey;
  readonly secretDigest: Buffer;
}

export interface ApiKeyCreateRecord {
  readonly apiKey: ApiKey;
  readonly secretDigest: Buffer;
}

export interface ApiKeyCreateWithAuditInput {
  readonly record: ApiKeyCreateRecord;
  readonly auditEvent: SecurityAuditEvent;
}

export interface ApiKeyRevokeWithAuditInput {
  readonly workspaceId: WorkspaceId;
  readonly apiKeyId: ApiKeyId;
  readonly revokedAt: Date;
  readonly auditEvent: SecurityAuditEvent;
}

export interface ApiKeyRepository {
  create(record: ApiKeyCreateRecord): Promise<void>;
  createWithAudit(input: ApiKeyCreateWithAuditInput): Promise<void>;
  findById(id: ApiKeyId): Promise<ApiKeyPersistedRecord | null>;
  findByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ApiKeyId,
  ): Promise<ApiKey | null>;
  listByWorkspaceId(workspaceId: WorkspaceId): Promise<readonly ApiKey[]>;
  revoke(id: ApiKeyId, revokedAt: Date): Promise<void>;
  revokeWithAudit(input: ApiKeyRevokeWithAuditInput): Promise<ApiKey>;
  countAll(): Promise<number>;
}
