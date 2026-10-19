import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { consoleFetch } from "../lib/console-api";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

export interface ToolResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface InternalToolVersionResource {
  readonly id: string;
  readonly toolId: string;
  readonly version: number;
  readonly type: "INTERNAL";
  readonly implementation: string;
  readonly createdAt: string;
}

export interface McpToolVersionResource {
  readonly id: string;
  readonly toolId: string;
  readonly version: number;
  readonly type: "MCP";
  readonly implementation: "MCP_V1";
  readonly mcp: {
    readonly connectorVersionId: string;
    readonly remoteToolName: string;
    readonly description?: string;
    readonly inputSchema: Record<string, unknown>;
  };
  readonly createdAt: string;
}

export type ToolVersionResource =
  InternalToolVersionResource | McpToolVersionResource;

export interface ConnectorResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConnectorVersionResource {
  readonly id: string;
  readonly connectorId: string;
  readonly version: number;
  readonly kind: "MCP";
  readonly transport: "STREAMABLE_HTTP" | "STDIO";
  readonly transportConfig:
    | { readonly endpointUrl: string }
    | {
        readonly command: string;
        readonly args: readonly string[];
        readonly cwd?: string;
        readonly environment?: Readonly<Record<string, string>>;
        readonly secretEnvironment?: Readonly<
          Record<string, { readonly configured: true }>
        >;
      };
  readonly auth?:
    | { readonly type: "BEARER"; readonly configured: true }
    | {
        readonly type: "HEADER";
        readonly headerName: string;
        readonly configured: true;
      };
  readonly createdAt: string;
}

export interface DiscoveredMcpTool {
  readonly remoteToolName: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
}

export function useToolsListQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["tools", workspaceId, "list"],
    enabled: workspaceId !== undefined,
    queryFn: () => consoleFetch<{ tools: ToolResource[] }>("/api/v1/tools"),
  });
}

export function useToolQuery(toolId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["tools", workspaceId, toolId, "detail"],
    enabled: workspaceId !== undefined && toolId !== undefined,
    queryFn: () =>
      consoleFetch<ToolResource>(
        `/api/v1/tools/${encodeURIComponent(toolId ?? "")}`,
      ),
  });
}

export function useToolVersionsQuery(toolId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["tools", workspaceId, toolId, "versions"],
    enabled: workspaceId !== undefined && toolId !== undefined,
    queryFn: () =>
      consoleFetch<{ versions: ToolVersionResource[] }>(
        `/api/v1/tools/${encodeURIComponent(toolId ?? "")}/versions`,
      ),
  });
}

export function useConnectorsListQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["connectors", workspaceId, "list"],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      consoleFetch<{ connectors: ConnectorResource[] }>("/api/v1/connectors"),
  });
}

export function useConnectorQuery(connectorId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["connectors", workspaceId, connectorId, "detail"],
    enabled: workspaceId !== undefined && connectorId !== undefined,
    queryFn: () =>
      consoleFetch<ConnectorResource>(
        `/api/v1/connectors/${encodeURIComponent(connectorId ?? "")}`,
      ),
  });
}

export function useConnectorVersionsQuery(connectorId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["connectors", workspaceId, connectorId, "versions"],
    enabled: workspaceId !== undefined && connectorId !== undefined,
    queryFn: () =>
      consoleFetch<{ versions: ConnectorVersionResource[] }>(
        `/api/v1/connectors/${encodeURIComponent(connectorId ?? "")}/versions`,
      ),
  });
}

export function useCreateConnectorMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (body: {
      readonly key: string;
      readonly name: string;
      readonly description?: string;
    }) =>
      consoleFetch<ConnectorResource>("/api/v1/connectors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["connectors", workspaceId],
      });
    },
  });
}

export function useUpdateConnectorMutation(connectorId: string) {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (body: {
      readonly name: string;
      readonly description?: string;
    }) =>
      consoleFetch<ConnectorResource>(
        `/api/v1/connectors/${encodeURIComponent(connectorId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["connectors", workspaceId],
      });
    },
  });
}

export function useAppendConnectorVersionMutation(connectorId: string) {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (body: {
      readonly kind: "MCP";
      readonly transport: "STREAMABLE_HTTP";
      readonly transportConfig: { readonly endpointUrl: string };
      readonly auth?:
        | {
            readonly type: "BEARER";
            readonly tokenSecret: { readonly key: string };
          }
        | {
            readonly type: "HEADER";
            readonly headerName: string;
            readonly valueSecret: { readonly key: string };
          };
    }) =>
      consoleFetch<ConnectorVersionResource>(
        `/api/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["connectors", workspaceId, connectorId],
      });
    },
  });
}

export function useDiscoverConnectorToolsMutation(
  connectorId: string,
  connectorVersionId: string,
) {
  return useMutation({
    mutationFn: () =>
      consoleFetch<{
        connectorVersionId: string;
        tools: DiscoveredMcpTool[];
      }>(
        `/api/v1/connectors/${encodeURIComponent(connectorId)}/versions/${encodeURIComponent(connectorVersionId)}/discover`,
        { method: "POST" },
      ),
  });
}

export function useImportMcpToolsMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (body: {
      readonly connectorVersionId: string;
      readonly tools: ReadonlyArray<{
        readonly remoteToolName: string;
        readonly toolKey: string;
        readonly toolName: string;
      }>;
    }) =>
      consoleFetch<{
        imported: ReadonlyArray<{
          readonly toolId: string;
          readonly toolVersionId: string;
          readonly remoteToolName: string;
          readonly toolKey: string;
          readonly createdNewToolVersion: boolean;
        }>;
      }>("/api/v1/connectors/import-mcp-tools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tools", workspaceId] });
    },
  });
}

export function useToolsCatalogQuery() {
  const workspaceId = useWorkspaceQueryScope();
  const toolsQuery = useToolsListQuery();
  return useQuery({
    queryKey: ["tools", workspaceId, "catalog"],
    enabled: workspaceId !== undefined && toolsQuery.data !== undefined,
    queryFn: async () => {
      const tools = toolsQuery.data?.tools ?? [];
      const entries = await Promise.all(
        tools.map(async (tool) => {
          const versions = await consoleFetch<{
            versions: ToolVersionResource[];
          }>(`/api/v1/tools/${encodeURIComponent(tool.id)}/versions`);
          return { tool, versions: versions.versions };
        }),
      );
      return entries;
    },
  });
}
