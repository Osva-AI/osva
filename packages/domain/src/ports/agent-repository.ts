import type { AgentId, AgentVersionId } from "@osva/contracts";

import type { Agent } from "../agent.js";
import type { AgentVersion } from "../agent-version.js";

export interface AgentRepository {
  saveAgent(agent: Agent): Promise<void>;
  findAgentById(id: AgentId): Promise<Agent | null>;
  saveAgentVersion(agentVersion: AgentVersion): Promise<void>;
  findAgentVersionById(id: AgentVersionId): Promise<AgentVersion | null>;
}
