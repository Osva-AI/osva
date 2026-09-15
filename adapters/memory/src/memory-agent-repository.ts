import type { AgentId, AgentVersionId } from "@osva/contracts";
import {
  DomainInvariantError,
  type Agent,
  type AgentRepository,
  type AgentVersion,
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
        throw new DomainInvariantError(
          `Agent key '${agent.key}' already exists in workspace '${agent.workspaceId}'.`,
        );
      }
    }

    this.agents.set(agent.id, agent);
  }

  async findAgentById(id: AgentId): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
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

  async findAgentVersionById(id: AgentVersionId): Promise<AgentVersion | null> {
    return this.agentVersions.get(id) ?? null;
  }
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
