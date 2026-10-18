import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { consoleFetch } from "../lib/console-api";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

export interface ModelProfileResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface ModelProfileVersionResource {
  readonly id: string;
  readonly modelProfileId: string;
  readonly version: number;
  readonly provider: string;
  readonly model: string;
  readonly modelProviderConnectionVersionId?: string;
  readonly createdAt: string;
}

export interface ModelProviderConnectionResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly provider: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ModelProviderConnectionVersionResource {
  readonly id: string;
  readonly connectionId: string;
  readonly version: number;
  readonly provider: string;
  readonly endpoint?: {
    readonly baseUrl: string;
    readonly allowPrivateNetworks?: boolean;
  };
  readonly credential?: { readonly configured: true };
  readonly createdAt: string;
}

export function useModelProfilesListQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["model-profiles", workspaceId, "list"],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      consoleFetch<{ modelProfiles: ModelProfileResource[] }>(
        "/api/v1/model-profiles",
      ),
  });
}

export function useModelProfileVersionsQuery(
  modelProfileId: string | undefined,
) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["model-profiles", workspaceId, modelProfileId, "versions"],
    enabled: workspaceId !== undefined && modelProfileId !== undefined,
    queryFn: () =>
      consoleFetch<{ versions: ModelProfileVersionResource[] }>(
        `/api/v1/model-profiles/${encodeURIComponent(modelProfileId ?? "")}/versions`,
      ),
  });
}

export function useModelProviderConnectionsListQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["model-provider-connections", workspaceId, "list"],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      consoleFetch<{ connections: ModelProviderConnectionResource[] }>(
        "/api/v1/model-provider-connections",
      ),
  });
}

export function useCreateModelProviderConnectionMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (body: {
      readonly key: string;
      readonly name: string;
      readonly provider: string;
    }) =>
      consoleFetch<ModelProviderConnectionResource>(
        "/api/v1/model-provider-connections",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["model-provider-connections", workspaceId],
      });
    },
  });
}

export function useAppendModelProviderConnectionVersionMutation(
  connectionId: string,
) {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (body: {
      readonly endpoint?: {
        readonly baseUrl: string;
        readonly allowPrivateNetworks?: boolean;
      };
      readonly credentialRef?: { readonly key: string };
    }) =>
      consoleFetch<ModelProviderConnectionVersionResource>(
        `/api/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["model-provider-connections", workspaceId],
      });
    },
  });
}

export function useTestModelProviderConnectionVersionMutation(
  connectionId: string,
  connectionVersionId: string,
) {
  return useMutation({
    mutationFn: (body: {
      readonly model?: string;
      readonly modelProfileVersionId?: string;
    }) =>
      consoleFetch<{
        status: "READY" | "FAILED";
        checkedAt: string;
        code?: string;
      }>(
        `/api/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions/${encodeURIComponent(connectionVersionId)}/test`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
  });
}

export function useAppendModelProfileVersionMutation(modelProfileId: string) {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (body: {
      readonly provider: string;
      readonly model: string;
      readonly modelProviderConnectionVersionId?: string;
    }) =>
      consoleFetch<ModelProfileVersionResource>(
        `/api/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["model-profiles", workspaceId],
      });
    },
  });
}
