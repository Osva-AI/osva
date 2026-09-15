import type { AgentId, WorkspaceId } from "@osva/contracts";
import { Agent } from "@osva/domain";

import type { agents } from "../schema/agents.js";
import { toDomainDate } from "./timestamps.js";

type AgentRow = typeof agents.$inferSelect;

export function agentToRow(agent: Agent) {
  return {
    id: agent.id,
    workspaceId: agent.workspaceId,
    key: agent.key,
    name: agent.name,
    createdAt: agent.createdAt,
  };
}

export function agentFromRow(row: AgentRow): Agent {
  return Agent.create({
    id: row.id as AgentId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    name: row.name,
    createdAt: toDomainDate(row.createdAt),
  });
}
