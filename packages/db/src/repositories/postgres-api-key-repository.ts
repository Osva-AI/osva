import type { ApiKeyId, WorkspaceId } from "@osva-ai/contracts";
import {
  ApiKeyNotFoundError,
  DuplicateApiKeyIdError,
  type ApiKey,
  type ApiKeyCreateRecord,
  type ApiKeyCreateWithAuditInput,
  type ApiKeyPersistedRecord,
  type ApiKeyRepository,
  type ApiKeyRevokeWithAuditInput,
} from "@osva/domain";
import { and, count, eq } from "drizzle-orm";

import type { Database } from "../database.js";
import { securityAuditEventToRow } from "../mappers/identity-mapper.js";
import { apiKeyCreateToRow, apiKeyFromRow } from "../mappers/api-key-mapper.js";
import {
  mapDatabaseError,
  postgresErrorCode,
  POSTGRES_UNIQUE_VIOLATION,
  withMappedDatabaseErrors,
} from "../postgres-errors.js";
import { apiKeys } from "../schema/api-keys.js";
import { securityAuditEvents } from "../schema/security-audit-events.js";

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

  async createWithAudit(input: ApiKeyCreateWithAuditInput): Promise<void> {
    const row = apiKeyCreateToRow(input.record);
    const auditRow = securityAuditEventToRow(input.auditEvent);

    try {
      await this.database.db.transaction(async (tx) => {
        await tx.insert(apiKeys).values(row);
        await tx.insert(securityAuditEvents).values(auditRow);
      });
    } catch (error) {
      if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        throw new DuplicateApiKeyIdError(input.record.apiKey.id);
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

  async revokeWithAudit(input: ApiKeyRevokeWithAuditInput): Promise<ApiKey> {
    const auditRow = securityAuditEventToRow(input.auditEvent);

    return await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.id, input.apiKeyId),
            eq(apiKeys.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);

      if (row === undefined) {
        throw new ApiKeyNotFoundError(input.apiKeyId);
      }

      const current = apiKeyFromRow(row).apiKey;
      if (current.revokedAt !== undefined) {
        return current;
      }

      const [updated] = await tx
        .update(apiKeys)
        .set({ revokedAt: input.revokedAt })
        .where(eq(apiKeys.id, input.apiKeyId))
        .returning();

      if (updated === undefined) {
        throw new ApiKeyNotFoundError(input.apiKeyId);
      }

      await tx.insert(securityAuditEvents).values(auditRow);
      return apiKeyFromRow(updated).apiKey;
    });
  }

  async countAll(): Promise<number> {
    const [row] = await this.database.db
      .select({ value: count() })
      .from(apiKeys);

    return Number(row?.value ?? 0);
  }
}
