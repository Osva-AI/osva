import type {
  InferenceRoutingPolicyDefinitionV1,
  InferenceRoutingPolicyId,
  InferenceRoutingPolicyVersionId,
  InferenceRoutingDecisionId,
} from "@osva-ai/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva-ai/contracts";

import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";
import {
  InferenceRoutingDecisionNotFoundError,
  InferenceRoutingPolicyNotFoundError,
  InferenceRoutingPolicyVersionNotFoundError,
} from "./errors.js";
import type { InferenceRoutingPolicyRepository } from "./ports/inference-routing-repository.js";

const ROUTING_RESOURCE = {
  kind: CONTROL_PLANE_RESOURCE_KINDS.inferenceRoutingPolicy,
} as const;

export interface InferenceRoutingApplicationClock {
  now(): Date;
}

export interface InferenceRoutingApplicationIds {
  createPolicyId(): InferenceRoutingPolicyId;
  createPolicyVersionId(): InferenceRoutingPolicyVersionId;
  createDecisionId(): InferenceRoutingDecisionId;
}

export interface InferenceRoutingApplicationDependencies {
  readonly routing: InferenceRoutingPolicyRepository;
  readonly clock: InferenceRoutingApplicationClock;
  readonly ids: InferenceRoutingApplicationIds;
}

export interface CreateInferenceRoutingPolicyCommand {
  readonly key: string;
  readonly definition: InferenceRoutingPolicyDefinitionV1;
}

export class CreateInferenceRoutingPolicy {
  constructor(private readonly deps: InferenceRoutingApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: CreateInferenceRoutingPolicyCommand,
  ) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.ADMIN,
      ROUTING_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const now = this.deps.clock.now();
    const policyId = this.deps.ids.createPolicyId();
    const versionId = this.deps.ids.createPolicyVersionId();

    await this.deps.routing.savePolicy({
      id: policyId,
      workspaceId,
      key: command.key,
      createdAt: now,
    });
    await this.deps.routing.savePolicyVersion({
      id: versionId,
      policyId,
      workspaceId,
      version: 1,
      definition: command.definition,
      createdAt: now,
    });

    return {
      policy: await this.deps.routing.findPolicyById(workspaceId, policyId),
      version: await this.deps.routing.findPolicyVersionById(
        workspaceId,
        versionId,
      ),
    };
  }
}

export interface AppendInferenceRoutingPolicyVersionCommand {
  readonly policyId: InferenceRoutingPolicyId;
  readonly definition: InferenceRoutingPolicyDefinitionV1;
}

export class AppendInferenceRoutingPolicyVersion {
  constructor(private readonly deps: InferenceRoutingApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: AppendInferenceRoutingPolicyVersionCommand,
  ) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.ADMIN,
      ROUTING_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const policy = await this.deps.routing.findPolicyById(
      workspaceId,
      command.policyId,
    );
    if (policy === null) {
      throw new InferenceRoutingPolicyNotFoundError(command.policyId);
    }

    const latest = await this.deps.routing.getLatestPolicyVersionNumber(
      workspaceId,
      command.policyId,
    );
    const versionId = this.deps.ids.createPolicyVersionId();
    const now = this.deps.clock.now();

    await this.deps.routing.savePolicyVersion({
      id: versionId,
      policyId: command.policyId,
      workspaceId,
      version: latest + 1,
      definition: command.definition,
      createdAt: now,
    });

    return this.deps.routing.findPolicyVersionById(workspaceId, versionId);
  }
}

export interface ActivateInferenceRoutingPolicyCommand {
  readonly policyVersionId: InferenceRoutingPolicyVersionId;
  readonly enabled: boolean;
}

export class ActivateInferenceRoutingPolicy {
  constructor(private readonly deps: InferenceRoutingApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: ActivateInferenceRoutingPolicyCommand,
  ) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.ADMIN,
      ROUTING_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const version = await this.deps.routing.findPolicyVersionById(
      workspaceId,
      command.policyVersionId,
    );
    if (version === null) {
      throw new InferenceRoutingPolicyVersionNotFoundError(
        command.policyVersionId,
      );
    }

    await this.deps.routing.upsertWorkspaceActivation({
      workspaceId,
      enabled: command.enabled,
      activePolicyVersionId: command.enabled
        ? command.policyVersionId
        : undefined,
      updatedAt: this.deps.clock.now(),
    });

    return this.deps.routing.findRuntimePolicyByWorkspaceId(workspaceId);
  }
}

export class ListInferenceRoutingPolicies {
  constructor(private readonly deps: InferenceRoutingApplicationDependencies) {}

  async execute(scope: ControlPlaneScope) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      ROUTING_RESOURCE,
    );
    return this.deps.routing.listPoliciesByWorkspace(
      controlPlaneWorkspaceId(scope),
    );
  }
}

export class GetInferenceRoutingPolicyVersion {
  constructor(private readonly deps: InferenceRoutingApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    policyVersionId: InferenceRoutingPolicyVersionId,
  ) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      ROUTING_RESOURCE,
    );
    const version = await this.deps.routing.findPolicyVersionById(
      controlPlaneWorkspaceId(scope),
      policyVersionId,
    );
    if (version === null) {
      throw new InferenceRoutingPolicyVersionNotFoundError(policyVersionId);
    }
    return version;
  }
}

export class GetInferenceRoutingDecision {
  constructor(private readonly deps: InferenceRoutingApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    decisionId: InferenceRoutingDecisionId,
  ) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      ROUTING_RESOURCE,
    );
    const decision = await this.deps.routing.findRoutingDecisionById(
      controlPlaneWorkspaceId(scope),
      decisionId,
    );
    if (decision === null) {
      throw new InferenceRoutingDecisionNotFoundError(decisionId);
    }
    return decision;
  }
}

export interface InferenceRoutingApplication {
  readonly createInferenceRoutingPolicy: CreateInferenceRoutingPolicy;
  readonly appendInferenceRoutingPolicyVersion: AppendInferenceRoutingPolicyVersion;
  readonly activateInferenceRoutingPolicy: ActivateInferenceRoutingPolicy;
  readonly listInferenceRoutingPolicies: ListInferenceRoutingPolicies;
  readonly getInferenceRoutingPolicyVersion: GetInferenceRoutingPolicyVersion;
  readonly getInferenceRoutingDecision: GetInferenceRoutingDecision;
}

export function createInferenceRoutingApplication(
  deps: InferenceRoutingApplicationDependencies,
): InferenceRoutingApplication {
  return {
    createInferenceRoutingPolicy: new CreateInferenceRoutingPolicy(deps),
    appendInferenceRoutingPolicyVersion:
      new AppendInferenceRoutingPolicyVersion(deps),
    activateInferenceRoutingPolicy: new ActivateInferenceRoutingPolicy(deps),
    listInferenceRoutingPolicies: new ListInferenceRoutingPolicies(deps),
    getInferenceRoutingPolicyVersion: new GetInferenceRoutingPolicyVersion(
      deps,
    ),
    getInferenceRoutingDecision: new GetInferenceRoutingDecision(deps),
  };
}
