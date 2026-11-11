import { useQuery } from "@tanstack/react-query";

import { workspaceScopedFetch } from "../lib/console-api";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

export interface ModelProfileListItem {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface ModelProfileVersionListItem {
  readonly id: string;
  readonly modelProfileId: string;
  readonly version: number;
  readonly provider: string;
  readonly model: string;
}

export function useModelProfilesWithVersionsQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["modelProfiles", workspaceId, "withVersions"],
    enabled: workspaceId !== undefined,
    queryFn: async () => {
      const list = await workspaceScopedFetch<{
        modelProfiles: ModelProfileListItem[];
      }>(workspaceId, "/api/v1/model-profiles");
      const withVersions = await Promise.all(
        list.modelProfiles.map(async (p) => {
          const versions = await workspaceScopedFetch<{
            versions: ModelProfileVersionListItem[];
          }>(
            workspaceId,
            `/api/v1/model-profiles/${encodeURIComponent(p.id)}/versions`,
          );
          return { profile: p, versions: versions.versions };
        }),
      );
      return withVersions;
    },
  });
}
