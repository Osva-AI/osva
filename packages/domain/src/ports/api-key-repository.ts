import type { ApiKeyId, WorkspaceId } from "@osva/contracts";

import type { ApiKey } from "../api-key.js";

export interface ApiKeyPersistedRecord {
  readonly apiKey: ApiKey;
  readonly secretDigest: Buffer;
}

export interface ApiKeyCreateRecord {
  readonly apiKey: ApiKey;
  readonly secretDigest: Buffer;
}

export interface ApiKeyRepository {
  create(record: ApiKeyCreateRecord): Promise<void>;
  findById(id: ApiKeyId): Promise<ApiKeyPersistedRecord | null>;
  findByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ApiKeyId,
  ): Promise<ApiKey | null>;
  listByWorkspaceId(workspaceId: WorkspaceId): Promise<readonly ApiKey[]>;
  revoke(id: ApiKeyId, revokedAt: Date): Promise<void>;
  countAll(): Promise<number>;
}
