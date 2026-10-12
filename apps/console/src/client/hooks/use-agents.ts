import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

export interface AgentVersionManifestResource {
  readonly schemaVersion?: string;
  readonly key?: string;
  readonly name?: string;
  readonly runtime?: {
    readonly type?: string;
    readonly key?: string;
    readonly entrypoint?: string;
    readonly integrity?: string;
    readonly protocolVersion?: string;
    readonly endpoint?: string;
    readonly image?: string;
  };
  readonly input?: {
    readonly schema?: unknown;
  };
  readonly output?: {
    readonly schema?: unknown;
  };
  readonly execution?: {
    readonly timeoutMs?: number;
    readonly maxAttempts?: number;
  };
  readonly capabilities?: {
    readonly model?: boolean;
    readonly tools?: readonly string[];
  };
  readonly models?: unknown;
  readonly tools?: unknown;
  readonly memory?: unknown;
  readonly knowledge?: unknown;
}

export interface AgentVersionResource {
  readonly id: string;
  readonly agentId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly manifest?: AgentVersionManifestResource;
}

export interface AgentVersionListResource {
  readonly versions: readonly AgentVersionResource[];
}

export interface AgentVersionCatalogResource {
  readonly entries: ReadonlyArray<{
    readonly agentId: string;
    readonly versions: readonly AgentVersionResource[];
  }>;
}

export function useAgentsListQuery() {
  return useQuery({
    queryKey: ["agents", "list"],
    queryFn: () => consoleFetch<AgentListResource>("/api/v1/agents"),
  });
}

export function useAgentQuery(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agents", agentId],
    enabled: agentId !== undefined && agentId.length > 0,
    queryFn: () =>
      consoleFetch<AgentResource>(
        `/api/v1/agents/${encodeURIComponent(agentId!)}`,
      ),
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

export function useAgentVersionQuery(
  agentId: string | undefined,
  agentVersionId: string | undefined,
) {
  return useQuery({
    queryKey: ["agents", agentId, "versions", agentVersionId],
    enabled:
      agentId !== undefined &&
      agentId.length > 0 &&
      agentVersionId !== undefined &&
      agentVersionId.length > 0,
    queryFn: () =>
      consoleFetch<AgentVersionResource>(
        `/api/v1/agents/${encodeURIComponent(agentId!)}/versions/${encodeURIComponent(agentVersionId!)}`,
      ),
  });
}

export function useAgentVersionCatalogQuery(enabled = true) {
  return useQuery({
    queryKey: ["agents", "version-catalog"],
    enabled,
    queryFn: async (): Promise<AgentVersionCatalogResource> => {
      const listed = await consoleFetch<AgentListResource>("/api/v1/agents");
      const entries: Array<{
        readonly agentId: string;
        readonly versions: readonly AgentVersionResource[];
      }> = [];
      for (const agent of listed.agents) {
        const versions = await consoleFetch<AgentVersionListResource>(
          `/api/v1/agents/${encodeURIComponent(agent.id)}/versions`,
        );
        entries.push({
          agentId: agent.id,
          versions: versions.versions,
        });
      }
      return { entries };
    },
  });
}

export interface CreateAgentInput {
  readonly key: string;
  readonly name: string;
}

export function useCreateAgentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) =>
      consoleFetch<AgentResource>("/api/v1/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: input.key,
          name: input.name,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["agents", "list"] });
    },
  });
}

export interface CreateAgentVersionInput {
  readonly agentId: string;
  readonly manifest: unknown;
}

export function useCreateAgentVersionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentVersionInput) =>
      consoleFetch<AgentVersionResource>(
        `/api/v1/agents/${encodeURIComponent(input.agentId)}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ manifest: input.manifest }),
        },
      ),
    onSuccess: async (_created, input) => {
      await queryClient.invalidateQueries({
        queryKey: ["agents", input.agentId, "versions"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["agents", "version-catalog"],
      });
    },
  });
}
