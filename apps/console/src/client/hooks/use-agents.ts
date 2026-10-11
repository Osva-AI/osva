import { useQuery } from "@tanstack/react-query";

import { consoleFetch } from "../lib/console-api";

export interface AgentResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface AgentListResource {
  readonly agents: readonly AgentResource[];
}

export interface AgentVersionResource {
  readonly id: string;
  readonly agentId: string;
  readonly version: number;
  readonly createdAt: string;
}

export interface AgentVersionListResource {
  readonly versions: readonly AgentVersionResource[];
}

export function useAgentsListQuery() {
  return useQuery({
    queryKey: ["agents", "list"],
    queryFn: () => consoleFetch<AgentListResource>("/api/v1/agents"),
  });
}

export function useAgentVersionsQuery(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agents", agentId, "versions"],
    enabled: agentId !== undefined && agentId.length > 0,
    queryFn: () =>
      consoleFetch<AgentVersionListResource>(
        `/api/v1/agents/${encodeURIComponent(agentId!)}/versions`,
      ),
  });
}
