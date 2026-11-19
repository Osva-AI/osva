import type { WorkspaceId } from "@osva-ai/contracts";
import type {
  InferenceResponseCachePolicyV1,
  WorkspaceInferenceCachePolicyRecordV1,
} from "@osva-ai/contracts";
import type {
  WorkspaceInferenceCachePolicyRepository,
  WorkspaceInferenceCachePolicyUpsertInput,
} from "@osva/domain";
import { eq } from "drizzle-orm";

import type { Database } from "../database.js";
import { securityAuditEventToRow } from "../mappers/identity-mapper.js";
import {
  workspaceInferenceCachePolicyToRuntimePolicy,
  workspaceInferenceCachePolicyUpsertToRow,
} from "../mappers/workspace-inference-cache-policy-mapper.js";
import { mapDatabaseError } from "../postgres-errors.js";
import { securityAuditEvents } from "../schema/security-audit-events.js";
import { workspaceInferenceCachePolicies } from "../schema/workspace-inference-cache-policies.js";

export class PostgresWorkspaceInferenceCachePolicyRepository implements WorkspaceInferenceCachePolicyRepository {
  constructor(private readonly database: Database) {}

  async findRuntimePolicyByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<InferenceResponseCachePolicyV1 | null> {
    const [row] = await this.database.db
      .select()
      .from(workspaceInferenceCachePolicies)
      .where(eq(workspaceInferenceCachePolicies.workspaceId, workspaceId))
      .limit(1);

    if (row === undefined) {
      return null;
    }

    return workspaceInferenceCachePolicyToRuntimePolicy(row);
  }

  async upsertWithAudit(
    input: WorkspaceInferenceCachePolicyUpsertInput,
  ): Promise<void> {
    const row = workspaceInferenceCachePolicyUpsertToRow({
      record: input.record,
      allowEvaluationJudgeCache: input.allowEvaluationJudgeCache,
      allowToolDefinitions: input.allowToolDefinitions,
      maxEntryBytes: input.maxEntryBytes,
    });
    const auditRow = securityAuditEventToRow(input.auditEvent);

    try {
      await this.database.db.transaction(async (tx) => {
        await tx
          .insert(workspaceInferenceCachePolicies)
          .values(row)
          .onConflictDoUpdate({
            target: workspaceInferenceCachePolicies.workspaceId,
            set: {
              schemaVersion: row.schemaVersion,
              enabled: row.enabled,
              determinism: row.determinism,
              ttlSeconds: row.ttlSeconds,
              maxEntryBytes: row.maxEntryBytes,
              allowEvaluationJudgeCache: row.allowEvaluationJudgeCache,
              allowToolDefinitions: row.allowToolDefinitions,
              revokedAt: row.revokedAt,
              updatedAt: row.updatedAt,
            },
          });
        await tx.insert(securityAuditEvents).values(auditRow);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}

export type { WorkspaceInferenceCachePolicyRecordV1 };
