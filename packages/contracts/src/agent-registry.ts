import type { AgentManifestV1 } from "./agent-manifest.js";
import type { AgentId, AgentVersionId, WorkspaceId } from "./ids.js";

export interface CreateAgentRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
}

export interface UpdateAgentRequestV1 {
  readonly name: string;
}

export interface CreateAgentVersionRequestV1 {
  readonly manifest: AgentManifestV1;
}

export interface AgentResourceV1 {
  readonly id: AgentId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface AgentVersionResourceV1 {
  readonly id: AgentVersionId;
  readonly agentId: AgentId;
  readonly version: number;
  readonly manifest: AgentManifestV1;
  readonly createdAt: string;
}

export interface AgentListResourceV1 {
  readonly agents: readonly AgentResourceV1[];
}

export interface AgentVersionListResourceV1 {
  readonly versions: readonly AgentVersionResourceV1[];
}
