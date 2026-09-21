import type { ApiKeyId, CommunityEditionRole } from "@osva/contracts";
import {
  ApiKey,
  type ApiKeyCreateRecord,
  type ApiKeyPersistedRecord,
} from "@osva/domain";

import type { apiKeys } from "../schema/api-keys.js";
import { toDomainDate } from "./timestamps.js";

type ApiKeyRow = typeof apiKeys.$inferSelect;

export function apiKeyCreateToRow(record: ApiKeyCreateRecord) {
  return {
    id: record.apiKey.id,
    workspaceId: record.apiKey.workspaceId,
    name: record.apiKey.name,
    role: record.apiKey.role,
    secretDigest: record.secretDigest,
    createdAt: record.apiKey.createdAt,
    expiresAt: record.apiKey.expiresAt ?? null,
    revokedAt: null,
  };
}

export function apiKeyFromRow(row: ApiKeyRow): ApiKeyPersistedRecord {
  return {
    apiKey: ApiKey.rehydrate({
      id: row.id as ApiKeyId,
      workspaceId:
        row.workspaceId as ApiKeyPersistedRecord["apiKey"]["workspaceId"],
      name: row.name,
      role: row.role as CommunityEditionRole,
      createdAt: toDomainDate(row.createdAt),
      expiresAt:
        row.expiresAt === null ? undefined : toDomainDate(row.expiresAt),
      revokedAt:
        row.revokedAt === null ? undefined : toDomainDate(row.revokedAt),
    }),
    secretDigest: row.secretDigest,
  };
}
