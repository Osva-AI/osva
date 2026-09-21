import type {
  AgentId,
  AgentManifestV1,
  AgentVersionId,
  WorkspaceId,
} from "@osva/contracts";

import type { Agent } from "../agent.js";
import type { AgentVersion } from "../agent-version.js";

export interface AgentMetadataUpdate {
  readonly name: string;
}

export interface AppendAgentVersionInput {
  readonly id: AgentVersionId;
  readonly agentId: AgentId;
  readonly manifest: AgentManifestV1;
  readonly createdAt: Date;
}

export interface AgentRepository {
  saveAgent(agent: Agent): Promise<void>;
  findAgentById(id: AgentId): Promise<Agent | null>;
  findAgentByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: AgentId,
  ): Promise<Agent | null>;
  listAgents(): Promise<Agent[]>;
  listAgentsByWorkspaceId(workspaceId: WorkspaceId): Promise<Agent[]>;
  updateAgentMetadata(
    id: AgentId,
    metadata: AgentMetadataUpdate,
  ): Promise<Agent | null>;
  saveAgentVersion(agentVersion: AgentVersion): Promise<void>;
  appendAgentVersion(input: AppendAgentVersionInput): Promise<AgentVersion>;
  findAgentVersionById(id: AgentVersionId): Promise<AgentVersion | null>;
  listAgentVersions(agentId: AgentId): Promise<AgentVersion[]>;
}
