import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  workspaceScopedFetch,
  workspaceMutationFetch,
} from "../lib/console-api";
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
      workspaceScopedFetch<{ modelProfiles: ModelProfileResource[] }>(
        workspaceId,
        "/api/v1/model-profiles",
      ),
  });
}

export function useCreateModelProfileMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (body: { readonly key: string; readonly name: string }) =>
      workspaceMutationFetch<ModelProfileResource>("/api/v1/model-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["model-profiles", workspaceId],
      });
    },
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
      workspaceScopedFetch<{ versions: ModelProfileVersionResource[] }>(
        workspaceId,
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
      workspaceScopedFetch<{ connections: ModelProviderConnectionResource[] }>(
        workspaceId,
        "/api/v1/model-provider-connections",
      ),
  });
}

export function useModelProviderConnectionVersionsQuery(
  connectionId: string | undefined,
) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: [
      "model-provider-connections",
      workspaceId,
      connectionId,
      "versions",
    ],
    enabled: workspaceId !== undefined && connectionId !== undefined,
    queryFn: () =>
      workspaceScopedFetch<{
        versions: ModelProviderConnectionVersionResource[];
      }>(
        workspaceId,
        `/api/v1/model-provider-connections/${encodeURIComponent(connectionId ?? "")}/versions`,
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
      workspaceScopedFetch<ModelProviderConnectionResource>(
        workspaceId,
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
      workspaceScopedFetch<ModelProviderConnectionVersionResource>(
        workspaceId,
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
      workspaceMutationFetch<{
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
      workspaceScopedFetch<ModelProfileVersionResource>(
        workspaceId,
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

export interface ModelBindingReadinessResource {
  readonly connectionCount: number;
  readonly profileCount: number;
  readonly hasBoundProfileVersion: boolean;
  readonly profileVersions: ReadonlyArray<{
    readonly profileId: string;
    readonly versions: readonly ModelProfileVersionResource[];
  }>;
}

export function useModelBindingReadinessQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["model-profiles", workspaceId, "binding-readiness"],
    enabled: workspaceId !== undefined,
    queryFn: async (): Promise<ModelBindingReadinessResource> => {
      const [connections, profiles] = await Promise.all([
        workspaceScopedFetch<{
          connections: ModelProviderConnectionResource[];
        }>(workspaceId, "/api/v1/model-provider-connections"),
        workspaceScopedFetch<{ modelProfiles: ModelProfileResource[] }>(
          workspaceId,
          "/api/v1/model-profiles",
        ),
      ]);
      const profileVersions: Array<{
        readonly profileId: string;
        readonly versions: readonly ModelProfileVersionResource[];
      }> = [];
      let hasBoundProfileVersion = false;
      for (const profile of profiles.modelProfiles) {
        const versions = await workspaceScopedFetch<{
          versions: ModelProfileVersionResource[];
        }>(
          workspaceId,
          `/api/v1/model-profiles/${encodeURIComponent(profile.id)}/versions`,
        );
        profileVersions.push({
          profileId: profile.id,
          versions: versions.versions,
        });
        if (
          !hasBoundProfileVersion &&
          versions.versions.some(
            (version) =>
              version.modelProviderConnectionVersionId !== undefined &&
              version.modelProviderConnectionVersionId.length > 0,
          )
        ) {
          hasBoundProfileVersion = true;
        }
      }
      return {
        connectionCount: connections.connections.length,
        profileCount: profiles.modelProfiles.length,
        hasBoundProfileVersion,
        profileVersions,
      };
    },
  });
}
