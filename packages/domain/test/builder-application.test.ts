import type {
  AgentId,
  AgentManifestV1,
  AgentVersionId,
  ConnectorVersionId,
  ModelProfileId,
  ModelProfileVersionId,
  ToolId,
  ToolVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { MCP_TOOL_IMPLEMENTATION } from "@osva-ai/contracts";
import { workflowDefinitionV3Schema } from "@osva-ai/contracts/schemas";
import { describe, expect, it } from "vitest";

import { assertValidAgentManifest } from "../src/agent-manifest-validation.js";
import {
  buildBuilderCatalogIndex,
  compileBuilderProposalPrePublication,
  compileBuilderProposalResolved,
  compileDeclarativeManifestFromNewAgent,
  type BuilderProposalAgentSpecV1,
  type BuilderProposalNewAgentV1,
  type BuilderProposalV1,
  type WorkspaceBuilderCapabilityCatalogV1,
} from "../src/builder/index.js";
import { assertWorkflowDefinition } from "../src/workflow-definition.js";
import { fakeControlPlaneScope } from "./control-plane-test-scope.js";
import { createManifest, NOW, workspaceId } from "./fixtures.js";

import { GetWorkspaceBuilderCapabilityCatalog } from "../src/builder/workspace-builder-capability-catalog.js";
import type { AgentRepository } from "../src/ports/agent-repository.js";
import type { ModelProfileRepository } from "../src/ports/model-profile-repository.js";
import type { ToolRepository } from "../src/ports/tool-repository.js";
import type { WorkspaceRepository } from "../src/ports/workspace-repository.js";
import { Agent } from "../src/agent.js";
import { AgentVersion } from "../src/agent-version.js";
import { ModelProfile } from "../src/model-profile.js";
import { ModelProfileVersion } from "../src/model-profile-version.js";
import { Tool } from "../src/tool.js";
import { ToolVersion } from "../src/tool-version.js";
import { Workspace } from "../src/workspace.js";

const ws: WorkspaceId = workspaceId;

function minimalNewAgent(ref: `bpr_${string}`): BuilderProposalNewAgentV1 {
  return {
    kind: "NEW",
    ref,
    agentKey: `key-${ref}`,
    agentName: `Name ${ref}`,
    instructions: "Do the task.",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    modelBindingName: "default",
    model: {
      bindingName: "default",
      modelProfileVersionId: "mpv-test" as ModelProfileVersionId,
    },
    tools: [],
    execution: {
      timeoutMs: 30_000,
      maxAttempts: 2,
      maxModelInvocations: 4,
      maxToolInvocations: 0,
    },
  };
}

class MapWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly workspace: Workspace) {}

  async save(): Promise<void> {}

  async findById(id: WorkspaceId): Promise<typeof this.workspace | null> {
    return this.workspace.id === id ? this.workspace : null;
  }

  async countAll(): Promise<number> {
    return 1;
  }

  async listIds(): Promise<readonly WorkspaceId[]> {
    return [this.workspace.id];
  }

  async listUnlinkedIds(): Promise<readonly WorkspaceId[]> {
    return [this.workspace.id];
  }
}

class MapModelProfileRepository implements ModelProfileRepository {
  private profiles = new Map<ModelProfileId, ModelProfile>();
  private versions = new Map<ModelProfileVersionId, ModelProfileVersion>();

  async saveModelProfile(profile: ModelProfile): Promise<void> {
    this.profiles.set(profile.id, profile);
  }

  async findModelProfileById(id: ModelProfileId): Promise<ModelProfile | null> {
    return this.profiles.get(id) ?? null;
  }

  async findModelProfileByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ModelProfileId,
  ): Promise<ModelProfile | null> {
    const p = this.profiles.get(id);
    return p?.workspaceId === workspaceId ? p : null;
  }

  async listModelProfiles(): Promise<ModelProfile[]> {
    return [...this.profiles.values()];
  }

  async listModelProfilesByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<ModelProfile[]> {
    return [...this.profiles.values()].filter(
      (p) => p.workspaceId === workspaceId,
    );
  }

  async updateModelProfileMetadata(): Promise<ModelProfile | null> {
    return null;
  }

  async saveModelProfileVersion(v: ModelProfileVersion): Promise<void> {
    this.versions.set(v.id, v);
  }

  async appendModelProfileVersion(): Promise<ModelProfileVersion> {
    throw new Error("not implemented");
  }

  async findModelProfileVersionById(
    id: ModelProfileVersionId,
  ): Promise<ModelProfileVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async listModelProfileVersions(
    modelProfileId: ModelProfileId,
  ): Promise<ModelProfileVersion[]> {
    return [...this.versions.values()].filter(
      (v) => v.modelProfileId === modelProfileId,
    );
  }
}

class MapToolRepository implements ToolRepository {
  private tools = new Map<ToolId, Tool>();
  private versions = new Map<ToolVersionId, ToolVersion>();

  async saveTool(tool: Tool): Promise<void> {
    this.tools.set(tool.id, tool);
  }

  async findToolById(id: ToolId): Promise<Tool | null> {
    return this.tools.get(id) ?? null;
  }

  async findToolByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ToolId,
  ): Promise<Tool | null> {
    const t = this.tools.get(id);
    return t?.workspaceId === workspaceId ? t : null;
  }

  async listTools(): Promise<Tool[]> {
    return [...this.tools.values()];
  }

  async listToolsByWorkspaceId(workspaceId: WorkspaceId): Promise<Tool[]> {
    return [...this.tools.values()].filter(
      (t) => t.workspaceId === workspaceId,
    );
  }

  async updateToolMetadata(): Promise<Tool | null> {
    return null;
  }

  async saveToolVersion(v: ToolVersion): Promise<void> {
    this.versions.set(v.id, v);
  }

  async appendToolVersion(): Promise<ToolVersion> {
    throw new Error("not implemented");
  }

  async findToolVersionById(id: ToolVersionId): Promise<ToolVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async listToolVersions(toolId: ToolId): Promise<ToolVersion[]> {
    return [...this.versions.values()].filter((v) => v.toolId === toolId);
  }
}

class MapAgentRepository implements AgentRepository {
  private agents = new Map<AgentId, Agent>();
  private versions = new Map<AgentVersionId, AgentVersion>();

  async saveAgent(agent: Agent): Promise<void> {
    this.agents.set(agent.id, agent);
  }

  async findAgentById(id: AgentId): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
  }

  async findAgentByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: AgentId,
  ): Promise<Agent | null> {
    const a = this.agents.get(id);
    return a?.workspaceId === workspaceId ? a : null;
  }

  async listAgents(): Promise<Agent[]> {
    return [...this.agents.values()];
  }

  async listAgentsByWorkspaceId(workspaceId: WorkspaceId): Promise<Agent[]> {
    return [...this.agents.values()].filter(
      (a) => a.workspaceId === workspaceId,
    );
  }

  async updateAgentMetadata(): Promise<Agent | null> {
    return null;
  }

  async saveAgentVersion(v: AgentVersion): Promise<void> {
    this.versions.set(v.id, v);
  }

  async appendAgentVersion(): Promise<AgentVersion> {
    throw new Error("not implemented");
  }

  async findAgentVersionById(id: AgentVersionId): Promise<AgentVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async listAgentVersions(agentId: AgentId): Promise<AgentVersion[]> {
    return [...this.versions.values()].filter((v) => v.agentId === agentId);
  }
}

async function createTestCatalog(): Promise<{
  catalog: WorkspaceBuilderCapabilityCatalogV1;
  index: ReturnType<typeof buildBuilderCatalogIndex>;
  mpvId: ModelProfileVersionId;
  toolVersionId: ToolVersionId;
}> {
  const workspace = Workspace.create({
    id: ws,
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

  const toolEntity = Tool.create({
    id: "tool-1" as ToolId,
    workspaceId: workspace.id,
    key: "noop",
    name: "Noop",
    createdAt: NOW,
  });
  await tools.saveTool(toolEntity);
  const tv = ToolVersion.create({
    id: "tv-test" as ToolVersionId,
    toolId: toolEntity.id,
    version: 1,
    type: "INTERNAL",
    implementation: "OSVA_ECHO_V1",
    createdAt: NOW,
  });
  await tools.saveToolVersion(tv);

  const catalogService = new GetWorkspaceBuilderCapabilityCatalog({
    workspaces: new MapWorkspaceRepository(workspace),
    agents,
    modelProfiles,
    tools,
  });

  const catalog = await catalogService.execute(fakeControlPlaneScope(ws));
  return {
    catalog,
    index: buildBuilderCatalogIndex(catalog),
    mpvId: mpv.id,
    toolVersionId: tv.id,
  };
}

function baseProposal(
  overrides: Partial<BuilderProposalV1> = {},
): BuilderProposalV1 {
  const a = minimalNewAgent("bpr_a");
  return {
    schemaVersion: "1",
    workflowRegistry: { key: "wf", name: "WF" },
    agents: [a],
    workflow: {
      nodes: [{ key: "n1", type: "AGENT", agentRef: "bpr_a" }],
      edges: [],
    },
    assumptions: [],
    unresolvedRequirements: [],
    ...overrides,
  };
}

describe("Builder M20.1", () => {
  it("valid single-agent proposal compiles pre-publication", async () => {
    const { index } = await createTestCatalog();
    const proposal = baseProposal();
    const r = compileBuilderProposalPrePublication(proposal, index);
    expect(r.ok).toBe(true);
    expect(r.compiledNewAgentManifests?.size).toBe(1);
    const manifest = r.compiledNewAgentManifests?.get("bpr_a");
    expect(manifest?.runtime.type).toBe("DECLARATIVE");
    assertValidAgentManifest(manifest as AgentManifestV1);
    expect(r.previewLogicalWorkflowDigest).toBeDefined();
    expect(
      (r as unknown as Record<string, unknown>).previewWorkflowDefinition,
    ).toBeUndefined();
  });

  it("valid sequential multi-agent proposal", async () => {
    const { index, mpvId } = await createTestCatalog();
    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [
        {
          ...minimalNewAgent("bpr_1"),
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
        {
          ...minimalNewAgent("bpr_2"),
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
      ],
      workflow: {
        nodes: [
          { key: "a", type: "AGENT", agentRef: "bpr_1" },
          { key: "b", type: "AGENT", agentRef: "bpr_2" },
        ],
        edges: [{ from: "a", to: "b" }],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    const r = compileBuilderProposalPrePublication(proposal, index);
    expect(r.ok).toBe(true);
  });

  it("parallel analysis with JOIN", async () => {
    const { index, mpvId } = await createTestCatalog();
    const mk = (ref: `bpr_${string}`): BuilderProposalNewAgentV1 => ({
      ...minimalNewAgent(ref),
      model: { bindingName: "default", modelProfileVersionId: mpvId },
    });

    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [
        mk("bpr_src"),
        mk("bpr_m1"),
        mk("bpr_m2"),
        mk("bpr_j"),
      ] satisfies readonly BuilderProposalAgentSpecV1[],
      workflow: {
        nodes: [
          { key: "src", type: "AGENT", agentRef: "bpr_src" },
          { key: "fork", type: "PARALLEL" },
          { key: "m1", type: "AGENT", agentRef: "bpr_m1" },
          { key: "m2", type: "AGENT", agentRef: "bpr_m2" },
          { key: "join", type: "JOIN" },
          { key: "out", type: "AGENT", agentRef: "bpr_j" },
        ],
        edges: [
          { from: "src", to: "fork" },
          { from: "fork", to: "m1" },
          { from: "fork", to: "m2" },
          { from: "m1", to: "join" },
          { from: "m2", to: "join" },
          { from: "join", to: "out" },
        ],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    expect(compileBuilderProposalPrePublication(proposal, index).ok).toBe(true);
  });

  it("human APPROVAL before report agent", async () => {
    const { index, mpvId } = await createTestCatalog();
    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [
        {
          ...minimalNewAgent("bpr_do"),
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
        {
          ...minimalNewAgent("bpr_report"),
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
      ],
      workflow: {
        nodes: [
          { key: "do", type: "AGENT", agentRef: "bpr_do" },
          { key: "ap", type: "APPROVAL", title: "Approve report" },
          { key: "rep", type: "AGENT", agentRef: "bpr_report" },
        ],
        edges: [
          { from: "do", to: "ap" },
          { from: "ap", to: "rep" },
        ],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    expect(compileBuilderProposalPrePublication(proposal, index).ok).toBe(true);
  });

  it("new and existing agent references in one proposal", async () => {
    const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
    const modelProfiles = new MapModelProfileRepository();
    const tools = new MapToolRepository();
    const agents = new MapAgentRepository();
    const mp = ModelProfile.create({
      id: "mp-x" as ModelProfileId,
      workspaceId: workspace.id,
      key: "mp",
      name: "MP",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(mp);
    const mpv = ModelProfileVersion.create({
      id: "mpv-x" as ModelProfileVersionId,
      modelProfileId: mp.id,
      version: 1,
      provider: "OPENAI",
      model: "gpt-x",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfileVersion(mpv);

    const agent = Agent.create({
      id: "agent-existing" as AgentId,
      workspaceId: workspace.id,
      key: "existing",
      name: "Existing",
      createdAt: NOW,
    });
    await agents.saveAgent(agent);
    const existingManifest = createManifest({
      key: "existing",
      name: "Existing",
    });
    const av = AgentVersion.create({
      id: "av-existing" as AgentVersionId,
      agentId: agent.id,
      version: 1,
      manifest: existingManifest,
      createdAt: NOW,
    });
    await agents.saveAgentVersion(av);

    const catalog = await new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    }).execute(fakeControlPlaneScope(ws));

    const index = buildBuilderCatalogIndex(catalog);

    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [
        {
          ...minimalNewAgent("bpr_new"),
          model: {
            bindingName: "default",
            modelProfileVersionId: mpv.id as ModelProfileVersionId,
          },
        },
        { kind: "EXISTING", ref: "bpr_old", agentVersionId: av.id },
      ],
      workflow: {
        nodes: [
          { key: "n1", type: "AGENT", agentRef: "bpr_new" },
          { key: "n2", type: "AGENT", agentRef: "bpr_old" },
        ],
        edges: [{ from: "n1", to: "n2" }],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    expect(compileBuilderProposalPrePublication(proposal, index).ok).toBe(true);
  });

  it("missing temporary agent reference", async () => {
    const { index } = await createTestCatalog();
    const proposal = baseProposal({
      agents: [minimalNewAgent("bpr_a")],
      workflow: {
        nodes: [{ key: "n1", type: "AGENT", agentRef: "bpr_missing" }],
        edges: [],
      },
    });
    const r = compileBuilderProposalPrePublication(proposal, index);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "UNKNOWN_AGENT_REFERENCE")).toBe(
      true,
    );
  });

  it("missing immutable version resolution in phase 2", async () => {
    const { index, mpvId } = await createTestCatalog();
    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
      ],
      workflow: {
        nodes: [{ key: "n1", type: "AGENT", agentRef: "bpr_a" }],
        edges: [],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    const pre = compileBuilderProposalPrePublication(proposal, index);
    expect(pre.ok).toBe(true);

    const resolved = compileBuilderProposalResolved(proposal, index, new Map());
    expect(resolved.ok).toBe(false);
    expect(
      resolved.issues.some(
        (i) => i.code === "MISSING_AGENT_VERSION_RESOLUTION",
      ),
    ).toBe(true);
  });

  it("unsupported node type rejected at schema parse", async () => {
    const { index } = await createTestCatalog();
    const bad = {
      ...baseProposal(),
      workflow: {
        nodes: [{ key: "x", type: "TOOL" }],
        edges: [],
      },
    };

    const r = compileBuilderProposalPrePublication(bad, index);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "INVALID_PROPOSAL_SCHEMA")).toBe(
      true,
    );
  });

  it("duplicate node keys", async () => {
    const { index, mpvId } = await createTestCatalog();
    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
        {
          ...minimalNewAgent("bpr_b"),
          agentKey: "other",
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
      ],
      workflow: {
        nodes: [
          { key: "dup", type: "AGENT", agentRef: "bpr_a" },
          { key: "dup", type: "AGENT", agentRef: "bpr_b" },
        ],
        edges: [],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    const r = compileBuilderProposalPrePublication(proposal, index);
    expect(r.ok).toBe(false);
    expect(
      r.issues.some(
        (i) =>
          i.code === "INVALID_PROPOSAL_SCHEMA" &&
          i.message.includes("Duplicate workflow node key"),
      ),
    ).toBe(true);
  });

  it("cycle detection", async () => {
    const { index, mpvId } = await createTestCatalog();
    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
        {
          ...minimalNewAgent("bpr_b"),
          agentKey: "kb",
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
      ],
      workflow: {
        nodes: [
          { key: "a", type: "AGENT", agentRef: "bpr_a" },
          { key: "b", type: "AGENT", agentRef: "bpr_b" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    const r = compileBuilderProposalPrePublication(proposal, index);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("cycle"))).toBe(true);
  });

  it("disconnected graph", async () => {
    const { index, mpvId } = await createTestCatalog();
    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
        {
          ...minimalNewAgent("bpr_b"),
          agentKey: "kb2",
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
      ],
      workflow: {
        nodes: [
          { key: "a", type: "AGENT", agentRef: "bpr_a" },
          { key: "b", type: "AGENT", agentRef: "bpr_b" },
        ],
        edges: [],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    const r = compileBuilderProposalPrePublication(proposal, index);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "INVALID_GRAPH_TOPOLOGY")).toBe(
      true,
    );
  });

  it("invalid BRANCH destination", async () => {
    const { index, mpvId } = await createTestCatalog();
    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
        {
          ...minimalNewAgent("bpr_b"),
          agentKey: "kb",
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
        {
          ...minimalNewAgent("bpr_c"),
          agentKey: "kc",
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
        {
          ...minimalNewAgent("bpr_out"),
          agentKey: "kout",
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
      ],
      workflow: {
        nodes: [
          { key: "a", type: "AGENT", agentRef: "bpr_a" },
          {
            key: "br",
            type: "BRANCH",
            selector: "/v",
            cases: [{ equals: 1, to: "b" }],
            defaultTo: "missing",
          },
          { key: "b", type: "AGENT", agentRef: "bpr_b" },
          { key: "c", type: "AGENT", agentRef: "bpr_c" },
          { key: "j", type: "JOIN" },
          { key: "out", type: "AGENT", agentRef: "bpr_out" },
        ],
        edges: [
          { from: "a", to: "br" },
          { from: "br", to: "b" },
          { from: "br", to: "c" },
          { from: "b", to: "j" },
          { from: "c", to: "j" },
          { from: "j", to: "out" },
        ],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    const r = compileBuilderProposalPrePublication(proposal, index);
    expect(r.ok).toBe(false);
    expect(
      r.issues.some(
        (i) =>
          i.code === "INVALID_GRAPH_TOPOLOGY" &&
          i.message.includes("defaultTo") &&
          i.message.includes("not an outgoing edge"),
      ),
    ).toBe(true);
  });

  it("missing model or tool binding vs catalog", async () => {
    const { index } = await createTestCatalog();
    const proposal = baseProposal({
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          model: {
            bindingName: "default",
            modelProfileVersionId: "foreign-mpv" as ModelProfileVersionId,
          },
          tools: [
            {
              bindingName: "t1",
              toolVersionId: "foreign-tv" as ToolVersionId,
            },
          ],
        },
      ],
    });

    const r = compileBuilderProposalPrePublication(proposal, index);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "MISSING_MODEL_SELECTION")).toBe(
      true,
    );
    expect(r.issues.some((i) => i.code === "MISSING_TOOL_SELECTION")).toBe(
      true,
    );
  });

  it("cross-workspace catalog rejects foreign version ids", async () => {
    const { index } = await createTestCatalog();
    const proposal = baseProposal();
    const pre = compileBuilderProposalPrePublication(proposal, index);
    expect(pre.ok).toBe(true);

    const foreign = "av-foreign" as AgentVersionId;
    const r = compileBuilderProposalResolved(
      proposal as BuilderProposalV1,
      index,
      new Map([["bpr_a", foreign]]),
    );
    expect(r.ok).toBe(false);
    expect(
      r.issues.some((i) => i.code === "UNAUTHORIZED_OR_FOREIGN_RESOURCE"),
    ).toBe(true);
  });

  it("phase 2 rejects EXISTING ref mapped to a different AgentVersionId", async () => {
    const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
    const modelProfiles = new MapModelProfileRepository();
    const tools = new MapToolRepository();
    const agents = new MapAgentRepository();

    const mp = ModelProfile.create({
      id: "mp-e" as ModelProfileId,
      workspaceId: workspace.id,
      key: "mp",
      name: "MP",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(mp);
    const mpv = ModelProfileVersion.create({
      id: "mpv-e" as ModelProfileVersionId,
      modelProfileId: mp.id,
      version: 1,
      provider: "OPENAI",
      model: "gpt",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfileVersion(mpv);

    const agent = Agent.create({
      id: "ex-agent" as AgentId,
      workspaceId: workspace.id,
      key: "k",
      name: "N",
      createdAt: NOW,
    });
    await agents.saveAgent(agent);
    const av = AgentVersion.create({
      id: "ex-av" as AgentVersionId,
      agentId: agent.id,
      version: 1,
      manifest: createManifest(),
      createdAt: NOW,
    });
    await agents.saveAgentVersion(av);
    const avOther = AgentVersion.create({
      id: "ex-av-other" as AgentVersionId,
      agentId: agent.id,
      version: 2,
      manifest: createManifest({ key: "k2", name: "n2" }),
      createdAt: NOW,
    });
    await agents.saveAgentVersion(avOther);

    const catalog = await new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    }).execute(fakeControlPlaneScope(ws));

    const index = buildBuilderCatalogIndex(catalog);

    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [{ kind: "EXISTING", ref: "bpr_ex", agentVersionId: av.id }],
      workflow: {
        nodes: [{ key: "n1", type: "AGENT", agentRef: "bpr_ex" }],
        edges: [],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    const r = compileBuilderProposalResolved(
      proposal,
      index,
      new Map([["bpr_ex", avOther.id]]),
    );
    expect(r.ok).toBe(false);
    expect(
      r.issues.some((i) => i.code === "UNSUPPORTED_NODE_CONFIGURATION"),
    ).toBe(true);
  });

  it("compiler has no publication side effects on catalog snapshots", async () => {
    const { catalog, index } = await createTestCatalog();
    const before = JSON.stringify(catalog);
    compileBuilderProposalPrePublication(baseProposal(), index);
    expect(JSON.stringify(catalog)).toBe(before);
  });

  it("invalid declarative configuration fails manifest validation", async () => {
    const { index, mpvId } = await createTestCatalog();
    const badSpec = {
      ...minimalNewAgent("bpr_a"),
      model: { bindingName: "default", modelProfileVersionId: mpvId },
      tools: [],
      execution: {
        timeoutMs: 30_000,
        maxAttempts: 2,
        maxModelInvocations: 4,
        maxToolInvocations: 1,
      },
    };

    const proposal = baseProposal({ agents: [badSpec] });
    const r = compileBuilderProposalPrePublication(proposal, index);
    expect(r.ok).toBe(false);
    expect(
      r.issues.some((i) => i.code === "INVALID_COMPILED_AGENT_MANIFEST"),
    ).toBe(true);
  });

  it("catalog serialization has no obvious secret fields", async () => {
    const catalog = (await createTestCatalog()).catalog;
    const json = JSON.stringify(catalog);
    expect(json).not.toMatch(/secret|password|token|apiKey|credential/i);
  });

  it("deterministic compilation digest for same input", async () => {
    const { index } = await createTestCatalog();
    const proposal = baseProposal();
    const a = compileBuilderProposalPrePublication(proposal, index);
    const b = compileBuilderProposalPrePublication(proposal, index);
    expect(a.previewLogicalWorkflowDigest).toBe(b.previewLogicalWorkflowDigest);
  });

  it("canonical agent and workflow validators accept compiled outputs", async () => {
    const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
    const modelProfiles = new MapModelProfileRepository();
    const tools = new MapToolRepository();
    const agents = new MapAgentRepository();
    const mp = ModelProfile.create({
      id: "mp-pub" as ModelProfileId,
      workspaceId: workspace.id,
      key: "mp",
      name: "MP",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(mp);
    const mpv = ModelProfileVersion.create({
      id: "mpv-pub" as ModelProfileVersionId,
      modelProfileId: mp.id,
      version: 1,
      provider: "OPENAI",
      model: "gpt",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfileVersion(mpv);

    const toolEntity = Tool.create({
      id: "tool-p" as ToolId,
      workspaceId: workspace.id,
      key: "web",
      name: "Web",
      createdAt: NOW,
    });
    await tools.saveTool(toolEntity);
    const tv = ToolVersion.create({
      id: "tv-p" as ToolVersionId,
      toolId: toolEntity.id,
      version: 1,
      type: "MCP",
      implementation: MCP_TOOL_IMPLEMENTATION,
      mcp: {
        connectorVersionId: "conn-v" as ConnectorVersionId,
        remoteToolName: "search",
        description: "search",
        inputSchema: {},
      },
      createdAt: NOW,
    });
    await tools.saveToolVersion(tv);

    const catalog = await new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    }).execute(fakeControlPlaneScope(ws));

    const index = buildBuilderCatalogIndex(catalog);

    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [
        {
          kind: "NEW",
          ref: "bpr_x",
          agentKey: "pub-agent",
          agentName: "Published",
          instructions: "Hello.",
          inputSchema: {},
          outputSchema: {},
          modelBindingName: "default",
          model: {
            bindingName: "default",
            modelProfileVersionId: mpv.id as ModelProfileVersionId,
          },
          tools: [{ bindingName: "web", toolVersionId: tv.id }],
          execution: {
            timeoutMs: 30_000,
            maxAttempts: 2,
            maxModelInvocations: 2,
            maxToolInvocations: 1,
          },
        },
      ],
      workflow: {
        nodes: [{ key: "only", type: "AGENT", agentRef: "bpr_x" }],
        edges: [],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    const pre = compileBuilderProposalPrePublication(proposal, index);
    expect(pre.ok).toBe(true);
    const firstAgent = proposal.agents[0];
    if (firstAgent?.kind !== "NEW") {
      throw new Error("expected NEW agent");
    }
    const manifest = compileDeclarativeManifestFromNewAgent(
      firstAgent as BuilderProposalNewAgentV1,
    );
    assertValidAgentManifest(manifest);

    const agent = Agent.create({
      id: "ag1" as AgentId,
      workspaceId: workspace.id,
      key: "pub-agent",
      name: "Published",
      createdAt: NOW,
    });
    await agents.saveAgent(agent);
    const av = AgentVersion.create({
      id: "av1" as AgentVersionId,
      agentId: agent.id,
      version: 1,
      manifest,
      createdAt: NOW,
    });
    await agents.saveAgentVersion(av);

    const catalog2 = await new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    }).execute(fakeControlPlaneScope(ws));

    const index2 = buildBuilderCatalogIndex(catalog2);

    const resolved = compileBuilderProposalResolved(
      proposal,
      index2,
      new Map([["bpr_x", av.id]]),
    );
    expect(resolved.ok).toBe(true);
    assertWorkflowDefinition(resolved.workflowDefinition!);
    expect(
      workflowDefinitionV3Schema.safeParse(resolved.workflowDefinition).success,
    ).toBe(true);
  });

  it("phase 2 resolves NEW refs after catalog gains AgentVersions; rejects unknown id", async () => {
    const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
    const modelProfiles = new MapModelProfileRepository();
    const tools = new MapToolRepository();
    const agents = new MapAgentRepository();
    const mp = ModelProfile.create({
      id: "mp-refresh" as ModelProfileId,
      workspaceId: workspace.id,
      key: "mp",
      name: "MP",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(mp);
    const mpv = ModelProfileVersion.create({
      id: "mpv-refresh" as ModelProfileVersionId,
      modelProfileId: mp.id,
      version: 1,
      provider: "OPENAI",
      model: "gpt",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfileVersion(mpv);

    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [
        {
          ...minimalNewAgent("bpr_p"),
          model: {
            bindingName: "default",
            modelProfileVersionId: mpv.id as ModelProfileVersionId,
          },
        },
      ],
      workflow: {
        nodes: [{ key: "n1", type: "AGENT", agentRef: "bpr_p" }],
        edges: [],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    const catalogEmpty = await new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    }).execute(fakeControlPlaneScope(ws));
    const indexEmpty = buildBuilderCatalogIndex(catalogEmpty);

    const pre = compileBuilderProposalPrePublication(proposal, indexEmpty);
    expect(pre.ok).toBe(true);

    const failUnknown = compileBuilderProposalResolved(
      proposal,
      indexEmpty,
      new Map([["bpr_p", "unknown-av" as AgentVersionId]]),
    );
    expect(failUnknown.ok).toBe(false);
    expect(
      failUnknown.issues.some(
        (i) => i.code === "UNAUTHORIZED_OR_FOREIGN_RESOURCE",
      ),
    ).toBe(true);

    const agent = Agent.create({
      id: "ag-refresh" as AgentId,
      workspaceId: workspace.id,
      key: "k",
      name: "Agent",
      createdAt: NOW,
    });
    await agents.saveAgent(agent);
    const first = proposal.agents[0];
    if (first?.kind !== "NEW") {
      throw new Error("expected NEW");
    }
    const manifest = compileDeclarativeManifestFromNewAgent(first);
    const av = AgentVersion.create({
      id: "av-refresh" as AgentVersionId,
      agentId: agent.id,
      version: 1,
      manifest,
      createdAt: NOW,
    });
    await agents.saveAgentVersion(av);

    const catalogFresh = await new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    }).execute(fakeControlPlaneScope(ws));
    const indexFresh = buildBuilderCatalogIndex(catalogFresh);

    const resolved = compileBuilderProposalResolved(
      proposal,
      indexFresh,
      new Map([["bpr_p", av.id]]),
    );
    expect(resolved.ok).toBe(true);
    assertWorkflowDefinition(resolved.workflowDefinition!);
    expect(
      workflowDefinitionV3Schema.safeParse(resolved.workflowDefinition).success,
    ).toBe(true);
  });

  it("research / parallel / approval / report fixture end-to-end", async () => {
    const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
    const modelProfiles = new MapModelProfileRepository();
    const tools = new MapToolRepository();
    const agents = new MapAgentRepository();

    const mp = ModelProfile.create({
      id: "mp-r" as ModelProfileId,
      workspaceId: workspace.id,
      key: "mp",
      name: "MP",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(mp);
    const mpv = ModelProfileVersion.create({
      id: "mpv-r" as ModelProfileVersionId,
      modelProfileId: mp.id,
      version: 1,
      provider: "OPENAI",
      model: "gpt-research",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfileVersion(mpv);

    const toolEntity = Tool.create({
      id: "tool-r" as ToolId,
      workspaceId: workspace.id,
      key: "web",
      name: "Web",
      createdAt: NOW,
    });
    await tools.saveTool(toolEntity);
    const tv = ToolVersion.create({
      id: "tv-r" as ToolVersionId,
      toolId: toolEntity.id,
      version: 1,
      type: "MCP",
      implementation: MCP_TOOL_IMPLEMENTATION,
      mcp: {
        connectorVersionId: "conn-r" as ConnectorVersionId,
        remoteToolName: "search",
        description: "search",
        inputSchema: {},
      },
      createdAt: NOW,
    });
    await tools.saveToolVersion(tv);

    const catalog = await new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    }).execute(fakeControlPlaneScope(ws));

    const index = buildBuilderCatalogIndex(catalog);

    const researcherTools = [{ bindingName: "web", toolVersionId: tv.id }];

    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: {
        key: "research_pipeline",
        name: "Research Pipeline",
      },
      agents: [
        {
          kind: "NEW",
          ref: "bpr_research",
          agentKey: "research_agent",
          agentName: "Research Agent",
          instructions: "Plan and delegate parallel analyst work.",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          modelBindingName: "default",
          model: {
            bindingName: "default",
            modelProfileVersionId: mpv.id as ModelProfileVersionId,
          },
          tools: researcherTools,
          execution: {
            timeoutMs: 60_000,
            maxAttempts: 2,
            maxModelInvocations: 8,
            maxToolInvocations: 4,
          },
        },
        {
          kind: "NEW",
          ref: "bpr_market",
          agentKey: "market_analyst",
          agentName: "Market Analyst",
          instructions: "Market analysis.",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          modelBindingName: "default",
          model: {
            bindingName: "default",
            modelProfileVersionId: mpv.id as ModelProfileVersionId,
          },
          tools: researcherTools,
          execution: {
            timeoutMs: 60_000,
            maxAttempts: 2,
            maxModelInvocations: 8,
            maxToolInvocations: 4,
          },
        },
        {
          kind: "NEW",
          ref: "bpr_risk",
          agentKey: "risk_analyst",
          agentName: "Risk Analyst",
          instructions: "Risk analysis.",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          modelBindingName: "default",
          model: {
            bindingName: "default",
            modelProfileVersionId: mpv.id as ModelProfileVersionId,
          },
          tools: [],
          execution: {
            timeoutMs: 60_000,
            maxAttempts: 2,
            maxModelInvocations: 8,
            maxToolInvocations: 0,
          },
        },
        {
          kind: "NEW",
          ref: "bpr_tech",
          agentKey: "technical_analyst",
          agentName: "Technical Analyst",
          instructions: "Technical analysis.",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          modelBindingName: "default",
          model: {
            bindingName: "default",
            modelProfileVersionId: mpv.id as ModelProfileVersionId,
          },
          tools: [],
          execution: {
            timeoutMs: 60_000,
            maxAttempts: 2,
            maxModelInvocations: 8,
            maxToolInvocations: 0,
          },
        },
        {
          kind: "NEW",
          ref: "bpr_report",
          agentKey: "report_agent",
          agentName: "Report Agent",
          instructions: "Synthesize final report after approval.",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          modelBindingName: "default",
          model: {
            bindingName: "default",
            modelProfileVersionId: mpv.id as ModelProfileVersionId,
          },
          tools: [],
          execution: {
            timeoutMs: 60_000,
            maxAttempts: 2,
            maxModelInvocations: 8,
            maxToolInvocations: 0,
          },
        },
      ],
      workflow: {
        nodes: [
          { key: "research", type: "AGENT", agentRef: "bpr_research" },
          { key: "parallel", type: "PARALLEL" },
          { key: "market", type: "AGENT", agentRef: "bpr_market" },
          { key: "risk", type: "AGENT", agentRef: "bpr_risk" },
          { key: "technical", type: "AGENT", agentRef: "bpr_tech" },
          { key: "join", type: "JOIN" },
          {
            key: "approval",
            type: "APPROVAL",
            title: "Approve analyst synthesis",
          },
          { key: "report", type: "AGENT", agentRef: "bpr_report" },
        ],
        edges: [
          { from: "research", to: "parallel" },
          { from: "parallel", to: "market" },
          { from: "parallel", to: "risk" },
          { from: "parallel", to: "technical" },
          { from: "market", to: "join" },
          { from: "risk", to: "join" },
          { from: "technical", to: "join" },
          { from: "join", to: "approval" },
          { from: "approval", to: "report" },
        ],
      },
      assumptions: ["Fixture uses catalog-backed model and tool IDs."],
      unresolvedRequirements: [],
    };

    const pre = compileBuilderProposalPrePublication(proposal, index);
    expect(pre.ok).toBe(true);

    const publishManifest = (ref: `bpr_${string}`) => {
      const spec = proposal.agents.find(
        (a) => a.kind === "NEW" && a.ref === ref,
      );
      if (spec === undefined || spec.kind !== "NEW") {
        throw new Error("missing spec");
      }
      return compileDeclarativeManifestFromNewAgent(spec);
    };

    const agentEntities = [
      { key: "research_agent", ref: "bpr_research" as const },
      { key: "market_analyst", ref: "bpr_market" as const },
      { key: "risk_analyst", ref: "bpr_risk" as const },
      { key: "technical_analyst", ref: "bpr_tech" as const },
      { key: "report_agent", ref: "bpr_report" as const },
    ] as const;

    const resolution = new Map<`bpr_${string}`, AgentVersionId>();
    let seq = 0;
    for (const { key, ref } of agentEntities) {
      seq += 1;
      const ag = Agent.create({
        id: `fixture-agent-${String(seq)}` as AgentId,
        workspaceId: workspace.id,
        key,
        name: key,
        createdAt: NOW,
      });
      await agents.saveAgent(ag);
      const manifest = publishManifest(ref);
      const av = AgentVersion.create({
        id: `fixture-av-${String(seq)}` as AgentVersionId,
        agentId: ag.id,
        version: 1,
        manifest,
        createdAt: NOW,
      });
      await agents.saveAgentVersion(av);
      resolution.set(ref, av.id);
    }

    const catalog2 = await new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    }).execute(fakeControlPlaneScope(ws));

    const index2 = buildBuilderCatalogIndex(catalog2);

    const resolved = compileBuilderProposalResolved(
      proposal,
      index2,
      resolution,
    );
    expect(resolved.ok).toBe(true);
    assertWorkflowDefinition(resolved.workflowDefinition!);
    expect(
      workflowDefinitionV3Schema.safeParse(resolved.workflowDefinition).success,
    ).toBe(true);
  });
});
