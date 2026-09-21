import type { ApiKeyId, WorkspaceId } from "@osva/contracts";
import {
  ApiKeyNotFoundError,
  DuplicateApiKeyIdError,
  type ApiKey,
  type ApiKeyCreateRecord,
  type ApiKeyPersistedRecord,
  type ApiKeyRepository,
} from "@osva/domain";
import { and, count, eq } from "drizzle-orm";

import type { Database } from "../database.js";
import { apiKeyCreateToRow, apiKeyFromRow } from "../mappers/api-key-mapper.js";
import {
  mapDatabaseError,
  postgresErrorCode,
  POSTGRES_UNIQUE_VIOLATION,
  withMappedDatabaseErrors,
} from "../postgres-errors.js";
import { apiKeys } from "../schema/api-keys.js";

export class PostgresApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly database: Database) {}

  async create(record: ApiKeyCreateRecord): Promise<void> {
    const row = apiKeyCreateToRow(record);

    try {
      await this.database.db.insert(apiKeys).values(row);
    } catch (error) {
      if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        throw new DuplicateApiKeyIdError(record.apiKey.id);
      }

      throw mapDatabaseError(error);
    }
  }

  async findById(id: ApiKeyId): Promise<ApiKeyPersistedRecord | null> {
    const [row] = await this.database.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .limit(1);

    return row === undefined ? null : apiKeyFromRow(row);
  }

  async findByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ApiKeyId,
  ): Promise<ApiKey | null> {
    const [row] = await this.database.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId)))
      .limit(1);

    return row === undefined ? null : apiKeyFromRow(row).apiKey;
  }

  async listByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<readonly ApiKey[]> {
    const rows = await this.database.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.workspaceId, workspaceId));

    return rows.map((row) => apiKeyFromRow(row).apiKey);
  }

  async revoke(id: ApiKeyId, revokedAt: Date): Promise<void> {
    const existing = await this.findById(id);
    if (existing === null) {
      throw new ApiKeyNotFoundError(id);
    }

    if (existing.apiKey.revokedAt !== undefined) {
      return;
    }

    await withMappedDatabaseErrors(() =>
      this.database.db
        .update(apiKeys)
        .set({ revokedAt })
        .where(eq(apiKeys.id, id)),
    );
  }

  async countAll(): Promise<number> {
    const [row] = await this.database.db
      .select({ value: count() })
      .from(apiKeys);

    return Number(row?.value ?? 0);
  }
}
