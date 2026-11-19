import type {
  InferenceRoutingDecisionId,
  InferenceRoutingDecisionRecordV1,
  InferenceRoutingPolicyDefinitionV1,
  InferenceRoutingPolicyId,
  InferenceRoutingPolicyRecordV1,
  InferenceRoutingPolicyVersionId,
  InferenceRoutingPolicyVersionRecordV1,
  InferenceRoutingRuntimePolicyV1,
  WorkspaceId,
} from "@osva-ai/contracts";

export interface InferenceRoutingPolicyVersionInsert {
  readonly id: InferenceRoutingPolicyVersionId;
  readonly policyId: InferenceRoutingPolicyId;
  readonly workspaceId: WorkspaceId;
  readonly version: number;
  readonly definition: InferenceRoutingPolicyDefinitionV1;
  readonly createdAt: Date;
}

export interface InferenceRoutingPolicyInsert {
  readonly id: InferenceRoutingPolicyId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly createdAt: Date;
}

export interface InferenceRoutingDecisionInsert {
  readonly id: InferenceRoutingDecisionId;
  readonly workspaceId: WorkspaceId;
  readonly policyVersionId: InferenceRoutingPolicyVersionId;
  readonly decision: InferenceRoutingDecisionRecordV1;
  readonly createdAt: Date;
}

export interface WorkspaceInferenceRoutingActivationUpsert {
  readonly workspaceId: WorkspaceId;
  readonly enabled: boolean;
  readonly activePolicyVersionId?: InferenceRoutingPolicyVersionId;
  readonly updatedAt: Date;
}

export interface InferenceRoutingPolicyRepository {
  savePolicy(policy: InferenceRoutingPolicyInsert): Promise<void>;
  findPolicyById(
    workspaceId: WorkspaceId,
    policyId: InferenceRoutingPolicyId,
  ): Promise<InferenceRoutingPolicyRecordV1 | null>;
  listPoliciesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly InferenceRoutingPolicyRecordV1[]>;

  savePolicyVersion(
    version: InferenceRoutingPolicyVersionInsert,
  ): Promise<void>;
  findPolicyVersionById(
    workspaceId: WorkspaceId,
    policyVersionId: InferenceRoutingPolicyVersionId,
  ): Promise<InferenceRoutingPolicyVersionRecordV1 | null>;
  listPolicyVersions(
    workspaceId: WorkspaceId,
    policyId: InferenceRoutingPolicyId,
  ): Promise<readonly InferenceRoutingPolicyVersionRecordV1[]>;
  getLatestPolicyVersionNumber(
    workspaceId: WorkspaceId,
    policyId: InferenceRoutingPolicyId,
  ): Promise<number>;

  upsertWorkspaceActivation(
    input: WorkspaceInferenceRoutingActivationUpsert,
  ): Promise<void>;
  findRuntimePolicyByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<InferenceRoutingRuntimePolicyV1 | null>;

  saveRoutingDecision(decision: InferenceRoutingDecisionInsert): Promise<void>;
  findRoutingDecisionById(
    workspaceId: WorkspaceId,
    decisionId: InferenceRoutingDecisionId,
  ): Promise<InferenceRoutingDecisionRecordV1 | null>;
}
