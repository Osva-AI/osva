import type {
  AgentId,
  AgentVersionId,
  ModelProfileId,
  ModelProfileVersionId,
  ToolId,
  ToolVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";

import type {
  BuilderProposalNewAgentV1,
  BuilderProposalV1,
} from "../src/builder/builder-proposal.js";
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

export function minimalNewAgent(
  ref: `bpr_${string}`,
): BuilderProposalNewAgentV1 {
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

export function baseProposal(
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

export class MapWorkspaceRepository implements WorkspaceRepository {
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

export class MapModelProfileRepository implements ModelProfileRepository {
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

export class MapToolRepository implements ToolRepository {
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

export class MapAgentRepository implements AgentRepository {
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
