import type { AgentRepository } from "../ports/agent-repository.js";
import type { WorkflowRepository } from "../ports/workflow-repository.js";
import type { ControlPlaneScope } from "../control-plane.js";

import { buildBuilderPublicationPlan } from "./builder-publication-preflight.js";
import type { BuilderPublicationPlanV1 } from "./builder-publication-types.js";
import type { GetWorkspaceBuilderCapabilityCatalog } from "./workspace-builder-capability-catalog.js";

export interface PrepareBuilderPublicationRequestV1 {
  readonly scope: ControlPlaneScope;
  readonly proposalUnknown: unknown;
}

export interface PrepareBuilderPublicationDependencies {
  readonly getCatalog: GetWorkspaceBuilderCapabilityCatalog;
  readonly agents: AgentRepository;
  readonly workflows: WorkflowRepository;
}

export class PrepareBuilderPublication {
  constructor(private readonly deps: PrepareBuilderPublicationDependencies) {}

  async execute(
    request: PrepareBuilderPublicationRequestV1,
  ): Promise<BuilderPublicationPlanV1> {
    const catalog = await this.deps.getCatalog.execute(request.scope);
    return buildBuilderPublicationPlan({
      scope: request.scope,
      proposalUnknown: request.proposalUnknown,
      catalog,
      agents: this.deps.agents,
      workflows: this.deps.workflows,
    });
  }
}
