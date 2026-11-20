import type {
  InferenceBudgetPolicyDefinitionV1,
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyRecordV1,
  InferenceBudgetPolicyVersionId,
  InferenceBudgetPolicyVersionRecordV1,
  InferenceBudgetRuntimePolicyV1,
  WorkspaceId,
  WorkspaceInferenceBudgetActivationV1,
} from "@osva-ai/contracts";

import type { SecurityAuditEvent } from "../security-audit-event.js";

export interface WorkspaceInferenceBudgetActivationUpsertInput {
  readonly workspaceId: WorkspaceId;
  readonly enabled: boolean;
  readonly activePolicyVersionId?: InferenceBudgetPolicyVersionId;
  readonly updatedAt: Date;
  readonly auditEvent: SecurityAuditEvent;
}

export interface InferenceBudgetPolicyVersionInsert {
  readonly id: InferenceBudgetPolicyVersionId;
  readonly policyId: InferenceBudgetPolicyId;
  readonly workspaceId: WorkspaceId;
  readonly version: number;
  readonly definition: InferenceBudgetPolicyDefinitionV1;
  readonly createdAt: Date;
}

export interface InferenceBudgetPolicyVersionAppend {
  readonly id: InferenceBudgetPolicyVersionId;
  readonly policyId: InferenceBudgetPolicyId;
  readonly workspaceId: WorkspaceId;
  readonly definition: InferenceBudgetPolicyDefinitionV1;
  readonly createdAt: Date;
}

export interface InferenceBudgetPolicyInsert {
  readonly id: InferenceBudgetPolicyId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly createdAt: Date;
}

export interface InferenceBudgetPolicyRepository {
  savePolicy(policy: InferenceBudgetPolicyInsert): Promise<void>;
  findPolicyById(
    workspaceId: WorkspaceId,
    policyId: InferenceBudgetPolicyId,
  ): Promise<InferenceBudgetPolicyRecordV1 | null>;
  listPoliciesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly InferenceBudgetPolicyRecordV1[]>;

  savePolicyVersion(version: InferenceBudgetPolicyVersionInsert): Promise<void>;
  findPolicyVersionById(
    workspaceId: WorkspaceId,
    policyVersionId: InferenceBudgetPolicyVersionId,
  ): Promise<InferenceBudgetPolicyVersionRecordV1 | null>;
  listPolicyVersions(
    workspaceId: WorkspaceId,
    policyId: InferenceBudgetPolicyId,
  ): Promise<readonly InferenceBudgetPolicyVersionRecordV1[]>;
  getLatestPolicyVersionNumber(
    workspaceId: WorkspaceId,
    policyId: InferenceBudgetPolicyId,
  ): Promise<number>;

  /** Serializes `(policy_id, version)` allocation under PostgreSQL authority. */
  appendPolicyVersion(
    version: InferenceBudgetPolicyVersionAppend,
  ): Promise<InferenceBudgetPolicyVersionRecordV1>;

  findRuntimePolicyByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<InferenceBudgetRuntimePolicyV1 | null>;

  findWorkspaceActivation(
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceInferenceBudgetActivationV1 | null>;

  upsertWorkspaceActivationWithAudit(
    input: WorkspaceInferenceBudgetActivationUpsertInput,
  ): Promise<void>;
}
