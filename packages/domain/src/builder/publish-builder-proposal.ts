import type {
  AgentId,
  AgentVersionId,
  SecurityAuditEventId,
  WorkflowDefinitionV3,
  WorkflowId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva-ai/contracts";

import { Agent } from "../agent.js";
import { AgentVersion } from "../agent-version.js";
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "../control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "../control-plane-resource-kinds.js";
import {
  BuilderPublicationIdempotencyConflictError,
  BuilderPublicationNotPublishableError,
  BuilderPublicationStalePlanError,
  WorkspaceNotFoundError,
} from "../errors.js";
import { assertValidAgentManifest } from "../agent-manifest-validation.js";
import type { AgentRepository } from "../ports/agent-repository.js";
import type { BuilderPublicationRepository } from "../ports/builder-publication-repository.js";
import type { KnowledgeRepository } from "../ports/knowledge-repository.js";
import type { MemoryNamespaceRepository } from "../ports/memory-namespace-repository.js";
import type { ModelProfileRepository } from "../ports/model-profile-repository.js";
import type { ToolRepository } from "../ports/tool-repository.js";
import type { WorkflowRepository } from "../ports/workflow-repository.js";
import type { WorkspaceRepository } from "../ports/workspace-repository.js";
import { Workflow } from "../workflow.js";
import { WorkflowVersion } from "../workflow-version.js";

import { assertAgentManifestWorkspaceBindings } from "./agent-manifest-workspace-bindings.js";
import { buildBuilderPublicationSucceededAuditEvent } from "./builder-publication-audit.js";
import { buildBuilderPublicationPlan } from "./builder-publication-preflight.js";
import {
  buildBuilderCatalogIndex,
  compileBuilderProposalPrePublication,
  compileBuilderProposalResolved,
  type BuilderCatalogIndexV1,
} from "./builder-compiler.js";
import type { WorkspaceBuilderAgentVersionCatalogEntryV1 } from "./workspace-builder-capability-catalog.js";
import type { BuilderPublicationPersistedResultV1 } from "./builder-publication-types.js";
import type {
  BuilderPublicationId,
  BuilderPublicationReceiptV1,
} from "./builder-publication-types.js";
import type {
  BuilderProposalAgentRef,
  BuilderProposalV1,
} from "./builder-proposal.js";
import type { GetWorkspaceBuilderCapabilityCatalog } from "./workspace-builder-capability-catalog.js";

const AGENT_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.agent };
const WORKFLOW_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.workflow };

export interface PublishBuilderProposalRequestV1 {
  readonly scope: ControlPlaneScope;
  readonly proposalUnknown: unknown;
  readonly expectedPlanDigest: string;
  readonly idempotencyKey: string;
  readonly acknowledgeUnresolvedRequirements?: boolean;
  readonly testHooks?: NonNullable<
    import("../ports/builder-publication-repository.js").BuilderPublicationAtomicPersistInput["testHooks"]
  >;
}

export interface PublishBuilderProposalDependencies {
  readonly getCatalog: GetWorkspaceBuilderCapabilityCatalog;
  readonly agents: AgentRepository;
  readonly workflows: WorkflowRepository;
  readonly workspaces: WorkspaceRepository;
  readonly modelProfiles: ModelProfileRepository;
  readonly tools: ToolRepository;
  readonly memoryNamespaces: MemoryNamespaceRepository;
  readonly knowledge: KnowledgeRepository;
  readonly publications: BuilderPublicationRepository;
  readonly clock: { now(): Date };
  readonly ids: { createId(): string };
}

export class PublishBuilderProposal {
  constructor(private readonly deps: PublishBuilderProposalDependencies) {}

  async execute(
    request: PublishBuilderProposalRequestV1,
  ): Promise<BuilderPublicationPersistedResultV1> {
    requireControlPlaneAuthorization(
      request.scope,
      AUTHORIZATION_ACTIONS.WRITE,
      AGENT_RESOURCE,
    );
    requireControlPlaneAuthorization(
      request.scope,
      AUTHORIZATION_ACTIONS.WRITE,
      WORKFLOW_RESOURCE,
    );

    const workspaceId = controlPlaneWorkspaceId(request.scope);
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(workspaceId);
    }

    const idempotencyKey = request.idempotencyKey.trim();
    if (idempotencyKey.length === 0) {
      throw new BuilderPublicationNotPublishableError(
        "idempotencyKey must be non-empty.",
      );
    }

    const existing =
      await this.deps.publications.findByWorkspaceAndIdempotencyKey(
        workspaceId,
        idempotencyKey,
      );
    if (existing !== null) {
      if (existing.planDigest !== request.expectedPlanDigest) {
        throw new BuilderPublicationIdempotencyConflictError(
          workspaceId,
          idempotencyKey,
        );
      }
      return { receipt: existing.receipt, replay: true };
    }

    const catalog = await this.deps.getCatalog.execute(request.scope);
    const plan = await buildBuilderPublicationPlan({
      scope: request.scope,
      proposalUnknown: request.proposalUnknown,
      catalog,
      agents: this.deps.agents,
      workflows: this.deps.workflows,
    });

    if (plan.planDigest !== request.expectedPlanDigest) {
      throw new BuilderPublicationStalePlanError(
        request.expectedPlanDigest,
        plan.planDigest,
      );
    }

    if (!plan.publishable) {
      throw new BuilderPublicationNotPublishableError();
    }

    if (
      plan.requiresUnresolvedAcknowledgement &&
      request.acknowledgeUnresolvedRequirements !== true
    ) {
      throw new BuilderPublicationNotPublishableError(
        "Unresolved requirements must be explicitly acknowledged before publication.",
      );
    }

    const index = buildBuilderCatalogIndex(catalog);
    const compiled = compileBuilderProposalPrePublication(
      request.proposalUnknown,
      index,
    );
    if (!compiled.ok || compiled.proposal === undefined) {
      throw new BuilderPublicationNotPublishableError();
    }

    const proposal = compiled.proposal;
    const manifests = compiled.compiledNewAgentManifests ?? new Map();

    const resolution = new Map<BuilderProposalAgentRef, AgentVersionId>();
    const newAgentRecords: {
      readonly ref: BuilderProposalAgentRef;
      readonly agent: Agent;
      readonly agentVersion: AgentVersion;
    }[] = [];

    const now = this.deps.clock.now();

    for (const spec of proposal.agents) {
      if (spec.kind === "EXISTING") {
        resolution.set(spec.ref, spec.agentVersionId);
        continue;
      }

      const manifest = manifests.get(spec.ref);
      if (manifest === undefined) {
        throw new BuilderPublicationNotPublishableError(
          `Missing compiled manifest for ref '${spec.ref}'.`,
        );
      }

      assertValidAgentManifest(manifest);
      await assertAgentManifestWorkspaceBindings(workspaceId, manifest, {
        modelProfiles: this.deps.modelProfiles,
        tools: this.deps.tools,
        memoryNamespaces: this.deps.memoryNamespaces,
        knowledge: this.deps.knowledge,
      });

      const agentId = this.deps.ids.createId() as AgentId;
      const agentVersionId = this.deps.ids.createId() as AgentVersionId;

      const agent = Agent.create({
        id: agentId,
        workspaceId,
        key: spec.agentKey,
        name: spec.agentName,
        createdAt: now,
      });

      const agentVersion = AgentVersion.create({
        id: agentVersionId,
        agentId,
        version: 1,
        manifest,
        createdAt: now,
      });

      resolution.set(spec.ref, agentVersionId);
      newAgentRecords.push({ ref: spec.ref, agent, agentVersion });
    }

    const catalogIndex = buildBuilderCatalogIndex(catalog);
    const pendingEntries: WorkspaceBuilderAgentVersionCatalogEntryV1[] =
      newAgentRecords.map((r) => ({
        agentVersionId: r.agentVersion.id,
        agentId: r.agent.id,
        agentKey: r.agent.key,
        agentName: r.agent.name,
        version: 1,
        manifestName: r.agentVersion.manifest.name,
        manifestKey: r.agentVersion.manifest.key,
      }));

    const resolvedIndex = extendBuilderCatalogIndex(
      catalogIndex,
      pendingEntries,
    );

    const resolvedCompile = compileBuilderProposalResolved(
      proposal,
      resolvedIndex,
      resolution,
    );

    if (
      !resolvedCompile.ok ||
      resolvedCompile.workflowDefinition === undefined
    ) {
      throw new BuilderPublicationNotPublishableError(
        "Resolved workflow compilation failed.",
      );
    }

    const workflowId = this.deps.ids.createId() as WorkflowId;
    const workflowVersionId = this.deps.ids.createId() as WorkflowVersionId;
    const publicationId = this.deps.ids.createId() as BuilderPublicationId;

    const workflow = Workflow.create({
      id: workflowId,
      workspaceId,
      key: proposal.workflowRegistry.key,
      name: proposal.workflowRegistry.name,
      description: proposal.workflowRegistry.description,
      createdAt: now,
      updatedAt: now,
    });

    const workflowVersion = WorkflowVersion.create({
      id: workflowVersionId,
      workflowId,
      workspaceId,
      version: 1,
      definition: resolvedCompile.workflowDefinition,
      createdAt: now,
    });

    const refResolution = [...resolution.entries()]
      .map(([ref, agentVersionId]) => ({ ref, agentVersionId }))
      .sort((a, b) => a.ref.localeCompare(b.ref));

    const receipt: BuilderPublicationReceiptV1 = {
      id: publicationId,
      state: "SUCCEEDED",
      workspaceId,
      planDigest: plan.planDigest,
      workflowId,
      workflowVersionId,
      newAgents: newAgentRecords
        .map((r) => ({
          agentId: r.agent.id,
          agentVersionId: r.agentVersion.id,
          ref: r.ref,
          agentKey: r.agent.key,
        }))
        .sort((a, b) => a.ref.localeCompare(b.ref)),
      reusedAgentVersionIds: proposal.agents
        .filter((s) => s.kind === "EXISTING")
        .map((s) => s.agentVersionId)
        .sort((a, b) => a.localeCompare(b)),
      refResolution,
      publishedAt: now.toISOString(),
    };

    const auditEvent = buildBuilderPublicationSucceededAuditEvent({
      id: this.deps.ids.createId() as SecurityAuditEventId,
      occurredAt: now,
      scope: request.scope,
      workspaceId,
      publicationId,
      workflowId,
      workflowVersionId,
      newAgentCount: newAgentRecords.length,
      reusedAgentCount: receipt.reusedAgentVersionIds.length,
    });

    const { replay } = await this.deps.publications.publishAtomically({
      publication: {
        id: publicationId,
        workspaceId,
        idempotencyKey,
        planDigest: plan.planDigest,
        receipt,
        createdAt: now,
      },
      newAgents: newAgentRecords.map((r) => r.agent),
      newAgentVersions: newAgentRecords.map((r) => r.agentVersion),
      workflow,
      workflowVersion,
      auditEvent,
      testHooks: request.testHooks,
    });

    if (replay) {
      const stored =
        await this.deps.publications.findByWorkspaceAndIdempotencyKey(
          workspaceId,
          idempotencyKey,
        );
      if (stored !== null) {
        return { receipt: stored.receipt, replay: true };
      }
    }

    return { receipt, replay: false };
  }
}

function extendBuilderCatalogIndex(
  base: BuilderCatalogIndexV1,
  extraAgentVersions: readonly WorkspaceBuilderAgentVersionCatalogEntryV1[],
): BuilderCatalogIndexV1 {
  const agentVersionsById = new Map(base.agentVersionsById);
  for (const entry of extraAgentVersions) {
    agentVersionsById.set(entry.agentVersionId, entry);
  }
  return {
    agentVersionsById,
    modelProfileVersionsById: base.modelProfileVersionsById,
    toolVersionsById: base.toolVersionsById,
  };
}
