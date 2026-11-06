import { useQuery } from "@tanstack/react-query";

import { consoleFetch } from "../lib/console-api";

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
  return useQuery({
    queryKey: ["modelProfiles", "withVersions"],
    queryFn: async () => {
      const list = await consoleFetch<{
        modelProfiles: ModelProfileListItem[];
      }>("/api/v1/model-profiles");
      const withVersions = await Promise.all(
        list.modelProfiles.map(async (p) => {
          const versions = await consoleFetch<{
            versions: ModelProfileVersionListItem[];
          }>(`/api/v1/model-profiles/${encodeURIComponent(p.id)}/versions`);
          return { profile: p, versions: versions.versions };
        }),
      );
      return withVersions;
    },
  });
}
