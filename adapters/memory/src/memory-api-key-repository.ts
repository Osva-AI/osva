import type { ApiKeyId, WorkspaceId } from "@osva/contracts";
import type {
  ApiKey,
  ApiKeyCreateRecord,
  ApiKeyPersistedRecord,
  ApiKeyRepository,
} from "@osva/domain";
import { ApiKeyNotFoundError, DuplicateApiKeyIdError } from "@osva/domain";

export class MemoryApiKeyRepository implements ApiKeyRepository {
  private readonly records = new Map<ApiKeyId, ApiKeyPersistedRecord>();

  async create(record: ApiKeyCreateRecord): Promise<void> {
    if (this.records.has(record.apiKey.id)) {
      throw new DuplicateApiKeyIdError(record.apiKey.id);
    }

    this.records.set(record.apiKey.id, {
      apiKey: record.apiKey,
      secretDigest: record.secretDigest,
    });
  }

  async findById(id: ApiKeyId): Promise<ApiKeyPersistedRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ApiKeyId,
  ): Promise<ApiKey | null> {
    const record = this.records.get(id);
    if (record === undefined) {
      return null;
    }

    return record.apiKey.workspaceId === workspaceId ? record.apiKey : null;
  }

  async listByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<readonly ApiKey[]> {
    return [...this.records.values()]
      .map((record) => record.apiKey)
      .filter((apiKey) => apiKey.workspaceId === workspaceId);
  }

  async revoke(id: ApiKeyId, revokedAt: Date): Promise<void> {
    const record = this.records.get(id);
    if (record === undefined) {
      throw new ApiKeyNotFoundError(id);
    }

    this.records.set(id, {
      ...record,
      apiKey: record.apiKey.revoke(revokedAt),
    });
  }

  async countAll(): Promise<number> {
    return this.records.size;
  }
}
