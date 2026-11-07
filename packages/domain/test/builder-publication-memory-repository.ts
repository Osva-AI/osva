import type { WorkspaceId } from "@osva-ai/contracts";

import {
  BuilderPublicationIdempotencyConflictError,
  type BuilderPublicationAtomicPersistInput,
  type BuilderPublicationRecordV1,
  type BuilderPublicationRepository,
} from "../src/index.js";
import type { AgentRepository } from "../src/ports/agent-repository.js";
import type { WorkflowRepository } from "../src/ports/workflow-repository.js";

export class MemoryBuilderPublicationRepository implements BuilderPublicationRepository {
  private readonly byIdempotency = new Map<
    string,
    BuilderPublicationRecordV1
  >();
  private readonly byId = new Map<string, BuilderPublicationRecordV1>();

  constructor(
    private readonly agents: AgentRepository,
    private readonly workflows: WorkflowRepository,
  ) {}

  async findByWorkspaceAndIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<BuilderPublicationRecordV1 | null> {
    return this.byIdempotency.get(`${workspaceId}:${idempotencyKey}`) ?? null;
  }

  async findByWorkspaceAndPublicationId(
    workspaceId: string,
    publicationId: string,
  ): Promise<BuilderPublicationRecordV1 | null> {
    const stored = this.byId.get(publicationId);
    return stored?.workspaceId === workspaceId ? stored : null;
  }

  async publishAtomically(
    input: BuilderPublicationAtomicPersistInput,
  ): Promise<{ readonly replay: boolean }> {
    const key = `${input.publication.workspaceId}:${input.publication.idempotencyKey}`;
    const existing = this.byIdempotency.get(key);
    if (existing !== undefined) {
      if (existing.planDigest !== input.publication.planDigest) {
        throw new BuilderPublicationIdempotencyConflictError(
          input.publication.workspaceId as WorkspaceId,
          input.publication.idempotencyKey,
        );
      }
      return { replay: true };
    }

    for (const agent of input.newAgents) {
      await this.agents.saveAgent(agent);
    }
    await input.testHooks?.afterNewAgentsPersisted?.();

    for (const version of input.newAgentVersions) {
      await this.agents.saveAgentVersion(version);
    }
    await input.testHooks?.afterNewAgentVersionsPersisted?.();

    await input.testHooks?.beforeWorkflowPersisted?.();

    await this.workflows.saveWorkflow(input.workflow);
    await this.workflows.saveWorkflowVersion(input.workflowVersion);

    this.byIdempotency.set(key, input.publication);
    this.byId.set(input.publication.id, input.publication);

    await input.testHooks?.beforeAuditPersisted?.();

    return { replay: false };
  }
}
