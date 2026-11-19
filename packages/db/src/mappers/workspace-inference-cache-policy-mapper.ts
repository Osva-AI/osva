import type { WorkspaceId } from "@osva-ai/contracts";
import {
  INFERENCE_RESPONSE_CACHE_POLICY_SCHEMA_VERSION,
  type WorkspaceInferenceCachePolicyRecordV1,
} from "@osva-ai/contracts";

import type { workspaceInferenceCachePolicies } from "../schema/workspace-inference-cache-policies.js";

type PolicyRow = typeof workspaceInferenceCachePolicies.$inferSelect;
type PolicyInsert = typeof workspaceInferenceCachePolicies.$inferInsert;

export function workspaceInferenceCachePolicyFromRow(
  row: PolicyRow,
): WorkspaceInferenceCachePolicyRecordV1 {
  return {
    schemaVersion: INFERENCE_RESPONSE_CACHE_POLICY_SCHEMA_VERSION,
    workspaceId: row.workspaceId as WorkspaceId,
    enabled: row.enabled && row.revokedAt === null,
    determinism:
      row.determinism === "REQUIRED_DETERMINISTIC"
        ? "REQUIRED_DETERMINISTIC"
        : "PROVIDER_DEFAULT",
    ttlSeconds: row.ttlSeconds ?? undefined,
    revokedAt: row.revokedAt?.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function workspaceInferenceCachePolicyToRuntimePolicy(
  row: PolicyRow,
): import("@osva-ai/contracts").InferenceResponseCachePolicyV1 {
  const base = workspaceInferenceCachePolicyFromRow(row);
  return {
    schemaVersion: base.schemaVersion,
    enabled: base.enabled,
    determinism: base.determinism,
    ttlSeconds: base.ttlSeconds,
    allowEvaluationJudgeCache: row.allowEvaluationJudgeCache,
    allowToolDefinitions: row.allowToolDefinitions,
    maxEntryBytes: row.maxEntryBytes ?? undefined,
    cachePolicyRevisionId: row.updatedAt.toISOString(),
  };
}

export function workspaceInferenceCachePolicyUpsertToRow(input: {
  readonly record: WorkspaceInferenceCachePolicyRecordV1;
  readonly allowEvaluationJudgeCache?: boolean;
  readonly allowToolDefinitions?: boolean;
  readonly maxEntryBytes?: number;
}): PolicyInsert {
  const { record } = input;
  return {
    workspaceId: record.workspaceId,
    schemaVersion: record.schemaVersion,
    enabled: record.enabled,
    determinism: record.determinism,
    ttlSeconds: record.ttlSeconds ?? null,
    maxEntryBytes: input.maxEntryBytes ?? null,
    allowEvaluationJudgeCache: input.allowEvaluationJudgeCache ?? false,
    allowToolDefinitions: input.allowToolDefinitions ?? false,
    revokedAt:
      record.revokedAt !== undefined ? new Date(record.revokedAt) : null,
    updatedAt: new Date(record.updatedAt),
  };
}
