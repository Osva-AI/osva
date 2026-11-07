import type {
  ModelProfileId,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { COMMUNITY_EDITION_ROLES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  BuilderPublicationIdempotencyConflictError,
  BuilderPublicationStalePlanError,
  PermissionDeniedError,
} from "../src/index.js";
import {
  PrepareBuilderPublication,
  PublishBuilderProposal,
  BUILDER_PUBLICATION_MODE_CREATE_V1,
  computeBuilderPublicationPlanDigest,
} from "../src/builder/index.js";
import { GetWorkspaceBuilderCapabilityCatalog } from "../src/builder/workspace-builder-capability-catalog.js";
import type { WorkflowRepository } from "../src/ports/workflow-repository.js";
import type { Workflow } from "../src/workflow.js";
import type { WorkflowVersion } from "../src/workflow-version.js";
import {
  baseProposal,
  MapAgentRepository,
  MapModelProfileRepository,
  MapToolRepository,
  MapWorkspaceRepository,
  minimalNewAgent,
} from "./builder-natural-language-test-helpers.js";
import { MemoryBuilderPublicationRepository } from "./builder-publication-memory-repository.js";
import { fakeControlPlaneScope } from "./control-plane-test-scope.js";
import { NOW, workspaceId } from "./fixtures.js";
import { ModelProfile } from "../src/model-profile.js";
import { ModelProfileVersion } from "../src/model-profile-version.js";
import { Workspace } from "../src/workspace.js";

class InMemoryWorkflowRepository implements WorkflowRepository {
  private workflows = new Map<string, Workflow>();
  private versions = new Map<string, WorkflowVersion>();

  async saveWorkflow(workflow: Workflow): Promise<void> {
    this.workflows.set(workflow.id, workflow);
  }

  async findWorkflowById(id: string): Promise<Workflow | null> {
    return this.workflows.get(id) ?? null;
  }

  async findWorkflowByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<Workflow | null> {
    const wf = this.workflows.get(id);
    return wf?.workspaceId === workspaceId ? wf : null;
  }

  async listWorkflows(): Promise<Workflow[]> {
    return [...this.workflows.values()];
  }

  async listWorkflowsByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<Workflow[]> {
    return [...this.workflows.values()].filter(
      (w) => w.workspaceId === workspaceId,
    );
  }

  async saveWorkflowVersion(workflowVersion: WorkflowVersion): Promise<void> {
    this.versions.set(workflowVersion.id, workflowVersion);
  }

  async appendWorkflowVersion(): Promise<WorkflowVersion> {
    throw new Error("not used");
  }

  async findWorkflowVersionById(id: string): Promise<WorkflowVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async listWorkflowVersions(workflowId: string): Promise<WorkflowVersion[]> {
    return [...this.versions.values()].filter(
      (v) => v.workflowId === workflowId,
    );
  }
}

async function seedCatalog() {
  const workspace = Workspace.create({
    id: workspaceId,
    name: "W",
    createdAt: NOW,
  });
  const modelProfiles = new MapModelProfileRepository();
  const tools = new MapToolRepository();
  const agents = new MapAgentRepository();
  const mp = ModelProfile.create({
    id: "mp-test" as ModelProfileId,
    workspaceId: workspace.id,
    key: "mp",
    name: "Test Profile",
    createdAt: NOW,
  });
  await modelProfiles.saveModelProfile(mp);
  const mpv = ModelProfileVersion.create({
    id: "mpv-test" as ModelProfileVersionId,
    modelProfileId: mp.id,
    version: 1,
    provider: "OPENAI",
    model: "gpt-test",
    createdAt: NOW,
  });
  await modelProfiles.saveModelProfileVersion(mpv);

  return { workspace, agents, modelProfiles, tools, mpv };
}

describe("builder publication (M20.4)", () => {
  it("builds a publishable plan for a valid NEW single-agent proposal", async () => {
    const { workspace, agents, modelProfiles, tools, mpv } =
      await seedCatalog();
    const scope = fakeControlPlaneScope(workspace.id);
    const proposal = baseProposal({
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          model: { bindingName: "default", modelProfileVersionId: mpv.id },
        },
      ],
    });

    const plan = await new PrepareBuilderPublication({
      getCatalog: new GetWorkspaceBuilderCapabilityCatalog({
        workspaces: new MapWorkspaceRepository(workspace),
        agents,
        modelProfiles,
        tools,
      }),
      agents,
      workflows: new InMemoryWorkflowRepository(),
    }).execute({ scope, proposalUnknown: proposal });

    expect(plan.publishable).toBe(true);
    expect(plan.newAgents).toHaveLength(1);
    expect(plan.planDigest.length).toBeGreaterThan(10);
  });

  it("rejects stale plan digest on publish", async () => {
    const { workspace, agents, modelProfiles, tools, mpv } =
      await seedCatalog();
    const scope = fakeControlPlaneScope(workspace.id);
    const workflows = new InMemoryWorkflowRepository();
    const proposal = baseProposal({
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          model: { bindingName: "default", modelProfileVersionId: mpv.id },
        },
      ],
    });

    const getCatalog = new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    });

    const publications = new MemoryBuilderPublicationRepository(
      agents,
      workflows,
    );

    const publish = new PublishBuilderProposal({
      getCatalog,
      agents,
      workflows,
      workspaces: new MapWorkspaceRepository(workspace),
      modelProfiles,
      tools,
      memoryNamespaces: { findNamespaceById: async () => null } as never,
      knowledge: { findIndexById: async () => null } as never,
      publications,
      clock: { now: () => new Date("2020-01-01T00:00:00.000Z") },
      ids: { createId: () => "id-1" },
    });

    await expect(
      publish.execute({
        scope,
        proposalUnknown: proposal,
        expectedPlanDigest: "stale-digest",
        idempotencyKey: "key-1",
      }),
    ).rejects.toBeInstanceOf(BuilderPublicationStalePlanError);
  });

  it("requires WRITE on agents and workflows for prepare", async () => {
    const { workspace, agents, modelProfiles, tools } = await seedCatalog();
    const viewerScope = fakeControlPlaneScope(
      workspace.id,
      COMMUNITY_EDITION_ROLES.VIEWER,
    );

    await expect(
      new PrepareBuilderPublication({
        getCatalog: new GetWorkspaceBuilderCapabilityCatalog({
          workspaces: new MapWorkspaceRepository(workspace),
          agents,
          modelProfiles,
          tools,
        }),
        agents,
        workflows: new InMemoryWorkflowRepository(),
      }).execute({ scope: viewerScope, proposalUnknown: baseProposal() }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("publishes NEW agent and workflow; replays same idempotency key", async () => {
    const { workspace, agents, modelProfiles, tools, mpv } =
      await seedCatalog();
    const scope = fakeControlPlaneScope(workspace.id);
    const workflows = new InMemoryWorkflowRepository();
    const proposal = baseProposal({
      workflowRegistry: { key: "pub-wf", name: "Published WF" },
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          agentKey: "pub_agent",
          model: { bindingName: "default", modelProfileVersionId: mpv.id },
        },
      ],
    });

    const getCatalog = new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    });

    const prepare = await new PrepareBuilderPublication({
      getCatalog,
      agents,
      workflows,
    }).execute({ scope, proposalUnknown: proposal });

    const publications = new MemoryBuilderPublicationRepository(
      agents,
      workflows,
    );

    let seq = 0;
    const publish = new PublishBuilderProposal({
      getCatalog,
      agents,
      workflows,
      workspaces: new MapWorkspaceRepository(workspace),
      modelProfiles,
      tools,
      memoryNamespaces: { findNamespaceById: async () => null } as never,
      knowledge: { findIndexById: async () => null } as never,
      publications,
      clock: { now: () => new Date("2020-01-01T00:00:00.000Z") },
      ids: {
        createId: () => {
          seq += 1;
          return `gen-${String(seq)}`;
        },
      },
    });

    const result = await publish.execute({
      scope,
      proposalUnknown: proposal,
      expectedPlanDigest: prepare.planDigest,
      idempotencyKey: "idem-pub-1",
    });

    expect(result.replay).toBe(false);
    expect(result.receipt.workflowId).toBeDefined();
    expect(result.receipt.newAgents).toHaveLength(1);

    const replay = await publish.execute({
      scope,
      proposalUnknown: proposal,
      expectedPlanDigest: prepare.planDigest,
      idempotencyKey: "idem-pub-1",
    });
    expect(replay.replay).toBe(true);
  });

  it("conflicts when idempotency key is reused with a different plan digest", async () => {
    const { workspace, agents, modelProfiles, tools, mpv } =
      await seedCatalog();
    const scope = fakeControlPlaneScope(workspace.id);
    const workflows = new InMemoryWorkflowRepository();
    const proposalA = baseProposal({
      workflowRegistry: { key: "wf-a", name: "A" },
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          agentKey: "agent_a",
          model: { bindingName: "default", modelProfileVersionId: mpv.id },
        },
      ],
    });

    const getCatalog = new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    });

    const publications = new MemoryBuilderPublicationRepository(
      agents,
      workflows,
    );

    let seq = 0;
    const publish = new PublishBuilderProposal({
      getCatalog,
      agents,
      workflows,
      workspaces: new MapWorkspaceRepository(workspace),
      modelProfiles,
      tools,
      memoryNamespaces: { findNamespaceById: async () => null } as never,
      knowledge: { findIndexById: async () => null } as never,
      publications,
      clock: { now: () => new Date("2020-01-01T00:00:00.000Z") },
      ids: {
        createId: () => {
          seq += 1;
          return `gen-b-${String(seq)}`;
        },
      },
    });

    const planA = computeBuilderPublicationPlanDigest({
      workspaceId: workspace.id,
      publicationMode: BUILDER_PUBLICATION_MODE_CREATE_V1,
      proposal: proposalA,
    });

    await publish.execute({
      scope,
      proposalUnknown: proposalA,
      expectedPlanDigest: planA,
      idempotencyKey: "shared",
    });

    const proposalB = {
      ...proposalA,
      workflowRegistry: { key: "wf-b", name: "B" },
    };
    const planB = computeBuilderPublicationPlanDigest({
      workspaceId: workspace.id,
      publicationMode: BUILDER_PUBLICATION_MODE_CREATE_V1,
      proposal: proposalB,
    });

    await expect(
      publish.execute({
        scope,
        proposalUnknown: proposalB,
        expectedPlanDigest: planB,
        idempotencyKey: "shared",
      }),
    ).rejects.toBeInstanceOf(BuilderPublicationIdempotencyConflictError);
  });
});
