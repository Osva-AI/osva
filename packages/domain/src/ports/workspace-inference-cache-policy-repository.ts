import type { WorkspaceId } from "@osva-ai/contracts";
import type {
  InferenceResponseCachePolicyV1,
  WorkspaceInferenceCachePolicyRecordV1,
} from "@osva-ai/contracts";

import type { SecurityAuditEvent } from "../security-audit-event.js";

export interface WorkspaceInferenceCachePolicyUpsertInput {
  readonly record: WorkspaceInferenceCachePolicyRecordV1;
  readonly allowEvaluationJudgeCache?: boolean;
  readonly allowToolDefinitions?: boolean;
  readonly maxEntryBytes?: number;
  readonly auditEvent: SecurityAuditEvent;
}

export interface WorkspaceInferenceCachePolicyRepository {
  findRuntimePolicyByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<InferenceResponseCachePolicyV1 | null>;

  upsertWithAudit(
    input: WorkspaceInferenceCachePolicyUpsertInput,
  ): Promise<void>;
}
