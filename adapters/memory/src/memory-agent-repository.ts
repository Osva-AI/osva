import type { AgentId, AgentVersionId } from "@osva/contracts";
import {
  AgentNotFoundError,
  AgentVersion,
  DomainInvariantError,
  DuplicateAgentKeyError,
  type Agent,
  type AgentMetadataUpdate,
  type AgentRepository,
  type AppendAgentVersionInput,
} from "@osva/domain";

export class MemoryAgentRepository implements AgentRepository {
  private readonly agents = new Map<AgentId, Agent>();
  private readonly agentVersions = new Map<AgentVersionId, AgentVersion>();

  async saveAgent(agent: Agent): Promise<void> {
    for (const existing of this.agents.values()) {
      if (
        existing.id !== agent.id &&
        existing.workspaceId === agent.workspaceId &&
        existing.key === agent.key
      ) {
        throw new DuplicateAgentKeyError(agent.workspaceId, agent.key);
      }
    }

    this.agents.set(agent.id, agent);
  }

  async findAgentById(id: AgentId): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
  }

  async listAgents(): Promise<Agent[]> {
    return [...this.agents.values()].sort(compareAgents);
  }

  async updateAgentMetadata(
    id: AgentId,
    metadata: AgentMetadataUpdate,
  ): Promise<Agent | null> {
    const existing = this.agents.get(id);
    if (existing === undefined) {
      return null;
    }

    const updated = existing.withName(metadata.name);
    this.agents.set(id, updated);
    return updated;
  }

  async saveAgentVersion(agentVersion: AgentVersion): Promise<void> {
    const existing = this.agentVersions.get(agentVersion.id);

    if (existing && !isSameAgentVersion(existing, agentVersion)) {
      throw new DomainInvariantError(
        `AgentVersion '${agentVersion.id}' is immutable and cannot be replaced with different content.`,
      );
    }

    if (!existing) {
      for (const stored of this.agentVersions.values()) {
        if (
          stored.agentId === agentVersion.agentId &&
          stored.version === agentVersion.version
        ) {
          throw new DomainInvariantError(
            `AgentVersion already exists for agent '${agentVersion.agentId}' version ${String(agentVersion.version)}.`,
          );
        }
      }
    }

    this.agentVersions.set(agentVersion.id, existing ?? agentVersion);
  }

  async appendAgentVersion(
    input: AppendAgentVersionInput,
  ): Promise<AgentVersion> {
    if (!this.agents.has(input.agentId)) {
      throw new AgentNotFoundError(input.agentId);
    }

    let maxVersion = 0;
    for (const stored of this.agentVersions.values()) {
      if (stored.agentId === input.agentId && stored.version > maxVersion) {
        maxVersion = stored.version;
      }
    }

    const agentVersion = AgentVersion.create({
      id: input.id,
      agentId: input.agentId,
      version: maxVersion + 1,
      manifest: input.manifest,
      createdAt: input.createdAt,
    });

    await this.saveAgentVersion(agentVersion);
    return agentVersion;
  }

  async findAgentVersionById(id: AgentVersionId): Promise<AgentVersion | null> {
    return this.agentVersions.get(id) ?? null;
  }

  async listAgentVersions(agentId: AgentId): Promise<AgentVersion[]> {
    return [...this.agentVersions.values()]
      .filter((version) => version.agentId === agentId)
      .sort(compareAgentVersions);
  }
}

function compareAgents(left: Agent, right: Agent): number {
  const created = left.createdAt.getTime() - right.createdAt.getTime();
  if (created !== 0) {
    return created;
  }

  if (left.id < right.id) {
    return -1;
  }

  if (left.id > right.id) {
    return 1;
  }

  return 0;
}

function compareAgentVersions(left: AgentVersion, right: AgentVersion): number {
  return left.version - right.version;
}

function isSameAgentVersion(left: AgentVersion, right: AgentVersion): boolean {
  return (
    left.id === right.id &&
    left.agentId === right.agentId &&
    left.version === right.version &&
    left.createdAt.getTime() === right.createdAt.getTime() &&
    JSON.stringify(left.manifest) === JSON.stringify(right.manifest)
  );
}
