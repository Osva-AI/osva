import type {
  InferenceRoutingDecisionId,
  InferenceRoutingDecisionRecordV1,
  InferenceRoutingPolicyId,
  InferenceRoutingPolicyRecordV1,
  InferenceRoutingPolicyVersionId,
  InferenceRoutingPolicyVersionRecordV1,
  InferenceRoutingRuntimePolicyV1,
  WorkspaceId,
} from "@osva-ai/contracts";
import { INFERENCE_ROUTING_POLICY_SCHEMA_VERSION } from "@osva-ai/contracts";
import type {
  InferenceRoutingDecisionInsert,
  InferenceRoutingPolicyInsert,
  InferenceRoutingPolicyRepository,
  InferenceRoutingPolicyVersionInsert,
  WorkspaceInferenceRoutingActivationUpsert,
} from "@osva/domain";

export class MemoryInferenceRoutingPolicyRepository implements InferenceRoutingPolicyRepository {
  private readonly policies = new Map<string, InferenceRoutingPolicyRecordV1>();
  private readonly versions = new Map<
    string,
    InferenceRoutingPolicyVersionRecordV1
  >();
  private readonly activations = new Map<
    string,
    WorkspaceInferenceRoutingActivationUpsert
  >();
  private readonly decisions = new Map<
    string,
    { workspaceId: WorkspaceId; record: InferenceRoutingDecisionRecordV1 }
  >();

  async savePolicy(policy: InferenceRoutingPolicyInsert): Promise<void> {
    this.policies.set(policy.id as string, {
      id: policy.id,
      workspaceId: policy.workspaceId,
      key: policy.key,
      createdAt: policy.createdAt.toISOString(),
    });
  }

  async findPolicyById(
    workspaceId: WorkspaceId,
    policyId: InferenceRoutingPolicyId,
  ): Promise<InferenceRoutingPolicyRecordV1 | null> {
    const policy = this.policies.get(policyId as string);
    return policy !== undefined && policy.workspaceId === workspaceId
      ? policy
      : null;
  }

  async listPoliciesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly InferenceRoutingPolicyRecordV1[]> {
    return [...this.policies.values()]
      .filter((policy) => policy.workspaceId === workspaceId)
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async savePolicyVersion(
    version: InferenceRoutingPolicyVersionInsert,
  ): Promise<void> {
    this.versions.set(version.id as string, {
      id: version.id,
      policyId: version.policyId,
      workspaceId: version.workspaceId,
      version: version.version,
      definition: version.definition,
      createdAt: version.createdAt.toISOString(),
    });
  }

  async findPolicyVersionById(
    workspaceId: WorkspaceId,
    policyVersionId: InferenceRoutingPolicyVersionId,
  ): Promise<InferenceRoutingPolicyVersionRecordV1 | null> {
    const version = this.versions.get(policyVersionId as string);
    return version !== undefined && version.workspaceId === workspaceId
      ? version
      : null;
  }

  async listPolicyVersions(
    workspaceId: WorkspaceId,
    policyId: InferenceRoutingPolicyId,
  ): Promise<readonly InferenceRoutingPolicyVersionRecordV1[]> {
    return [...this.versions.values()]
      .filter(
        (version) =>
          version.workspaceId === workspaceId && version.policyId === policyId,
      )
      .sort((a, b) => b.version - a.version);
  }

  async getLatestPolicyVersionNumber(
    workspaceId: WorkspaceId,
    policyId: InferenceRoutingPolicyId,
  ): Promise<number> {
    const versions = await this.listPolicyVersions(workspaceId, policyId);
    return versions[0]?.version ?? 0;
  }

  async upsertWorkspaceActivation(
    input: WorkspaceInferenceRoutingActivationUpsert,
  ): Promise<void> {
    this.activations.set(input.workspaceId as string, input);
  }

  async findRuntimePolicyByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<InferenceRoutingRuntimePolicyV1 | null> {
    const activation = this.activations.get(workspaceId as string);
    if (activation === undefined) {
      return null;
    }

    if (!activation.enabled || activation.activePolicyVersionId === undefined) {
      return {
        schemaVersion: INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
        enabled: false,
        policyRevisionId: activation.updatedAt.toISOString(),
      };
    }

    const version = await this.findPolicyVersionById(
      workspaceId,
      activation.activePolicyVersionId,
    );
    if (version === null) {
      return {
        schemaVersion: INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
        enabled: false,
        policyRevisionId: activation.updatedAt.toISOString(),
      };
    }

    return {
      schemaVersion: INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
      enabled: true,
      policyVersionId: version.id,
      definition: version.definition,
      policyRevisionId: activation.updatedAt.toISOString(),
    };
  }

  async saveRoutingDecision(
    decision: InferenceRoutingDecisionInsert,
  ): Promise<void> {
    this.decisions.set(decision.id as string, {
      workspaceId: decision.workspaceId,
      record: {
        ...decision.decision,
        id: decision.id,
      },
    });
  }

  async findRoutingDecisionById(
    workspaceId: WorkspaceId,
    decisionId: InferenceRoutingDecisionId,
  ): Promise<InferenceRoutingDecisionRecordV1 | null> {
    const row = this.decisions.get(decisionId as string);
    return row !== undefined && row.workspaceId === workspaceId
      ? row.record
      : null;
  }
}
