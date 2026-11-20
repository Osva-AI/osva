import type {
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyRecordV1,
  InferenceBudgetPolicyVersionId,
  InferenceBudgetPolicyVersionRecordV1,
  InferenceBudgetRuntimePolicyV1,
  WorkspaceId,
  WorkspaceInferenceBudgetActivationV1,
} from "@osva-ai/contracts";
import {
  INFERENCE_BUDGET_POLICY_SCHEMA_VERSION,
  createDefaultInferenceBudgetRuntimePolicy,
} from "@osva-ai/contracts";
import type {
  InferenceBudgetPolicyInsert,
  InferenceBudgetPolicyRepository,
  InferenceBudgetPolicyVersionAppend,
  InferenceBudgetPolicyVersionInsert,
  WorkspaceInferenceBudgetActivationUpsertInput,
} from "@osva/domain";

export class MemoryInferenceBudgetPolicyRepository implements InferenceBudgetPolicyRepository {
  private readonly policies = new Map<string, InferenceBudgetPolicyRecordV1>();
  private readonly versions = new Map<
    string,
    InferenceBudgetPolicyVersionRecordV1
  >();
  private readonly activations = new Map<
    string,
    WorkspaceInferenceBudgetActivationV1
  >();

  async savePolicy(policy: InferenceBudgetPolicyInsert): Promise<void> {
    this.policies.set(policy.id as string, {
      id: policy.id,
      workspaceId: policy.workspaceId,
      key: policy.key,
      createdAt: policy.createdAt.toISOString(),
    });
  }

  async findPolicyById(
    workspaceId: WorkspaceId,
    policyId: InferenceBudgetPolicyId,
  ): Promise<InferenceBudgetPolicyRecordV1 | null> {
    const policy = this.policies.get(policyId as string);
    return policy !== undefined && policy.workspaceId === workspaceId
      ? policy
      : null;
  }

  async listPoliciesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly InferenceBudgetPolicyRecordV1[]> {
    return [...this.policies.values()]
      .filter((policy) => policy.workspaceId === workspaceId)
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async savePolicyVersion(
    version: InferenceBudgetPolicyVersionInsert,
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
    policyVersionId: InferenceBudgetPolicyVersionId,
  ): Promise<InferenceBudgetPolicyVersionRecordV1 | null> {
    const version = this.versions.get(policyVersionId as string);
    return version !== undefined && version.workspaceId === workspaceId
      ? version
      : null;
  }

  async listPolicyVersions(
    workspaceId: WorkspaceId,
    policyId: InferenceBudgetPolicyId,
  ): Promise<readonly InferenceBudgetPolicyVersionRecordV1[]> {
    return [...this.versions.values()]
      .filter(
        (version) =>
          version.workspaceId === workspaceId && version.policyId === policyId,
      )
      .sort((a, b) => b.version - a.version);
  }

  async getLatestPolicyVersionNumber(
    workspaceId: WorkspaceId,
    policyId: InferenceBudgetPolicyId,
  ): Promise<number> {
    const versions = await this.listPolicyVersions(workspaceId, policyId);
    return versions[0]?.version ?? 0;
  }

  async appendPolicyVersion(
    version: InferenceBudgetPolicyVersionAppend,
  ): Promise<InferenceBudgetPolicyVersionRecordV1> {
    const nextVersion =
      (await this.getLatestPolicyVersionNumber(
        version.workspaceId,
        version.policyId,
      )) + 1;
    await this.savePolicyVersion({
      ...version,
      version: nextVersion,
    });
    const saved = await this.findPolicyVersionById(
      version.workspaceId,
      version.id,
    );
    if (saved === null) {
      throw new Error("Failed to append inference budget policy version.");
    }
    return saved;
  }

  async findWorkspaceActivation(
    workspaceId: WorkspaceId,
  ): Promise<WorkspaceInferenceBudgetActivationV1 | null> {
    return this.activations.get(workspaceId as string) ?? null;
  }

  setWorkspaceActivation(
    activation: WorkspaceInferenceBudgetActivationV1,
  ): void {
    this.activations.set(activation.workspaceId as string, activation);
  }

  async upsertWorkspaceActivationWithAudit(
    input: WorkspaceInferenceBudgetActivationUpsertInput,
  ): Promise<void> {
    this.activations.set(input.workspaceId as string, {
      schemaVersion: "1",
      workspaceId: input.workspaceId,
      enabled: input.enabled,
      activePolicyVersionId: input.activePolicyVersionId,
      updatedAt: input.updatedAt.toISOString(),
    });
  }

  async findRuntimePolicyByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<InferenceBudgetRuntimePolicyV1 | null> {
    const activation = this.activations.get(workspaceId as string);
    if (activation === undefined) {
      return null;
    }

    if (!activation.enabled || activation.activePolicyVersionId === undefined) {
      return {
        ...createDefaultInferenceBudgetRuntimePolicy(),
        policyRevisionId: activation.updatedAt,
      };
    }

    const version = await this.findPolicyVersionById(
      workspaceId,
      activation.activePolicyVersionId,
    );
    if (version === null) {
      return {
        ...createDefaultInferenceBudgetRuntimePolicy(),
        policyRevisionId: activation.updatedAt,
      };
    }

    return {
      schemaVersion: INFERENCE_BUDGET_POLICY_SCHEMA_VERSION,
      enabled: true,
      policyVersionId: version.id,
      definition: version.definition,
      policyRevisionId: activation.updatedAt,
    };
  }
}
