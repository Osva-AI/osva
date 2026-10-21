import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { consoleFetch } from "../lib/console-api";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

export interface KnowledgeSourceResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly artifactId: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface KnowledgeIndexResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly knowledgeSourceId: string;
  readonly status: string;
  readonly parserKey: string;
  readonly parserVersion: string;
  readonly chunkerKey: string;
  readonly chunkerVersion: string;
  readonly chunkSize: number;
  readonly chunkOverlap: number;
  readonly embeddingProvider: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  readonly distanceMetric: string;
  readonly pipelineFingerprint: string;
  readonly extractedArtifactId?: string;
  readonly attemptCount: number;
  readonly chunkCount?: number;
  readonly embeddedChunkCount?: number;
  readonly lastErrorCode?: string;
  readonly lastErrorMessage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly readyAt?: string;
}

export interface KnowledgeHitResource {
  readonly knowledgeChunkId: string;
  readonly knowledgeIndexId: string;
  readonly knowledgeSourceId: string;
  readonly text: string;
  readonly score: number;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly location?: {
    readonly page?: number;
    readonly heading?: string;
    readonly sourceSegmentOrdinal?: number;
  };
}

export interface MemoryNamespaceResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
}

export interface MemoryRecordResource {
  readonly key: string;
  readonly revision: number;
  readonly value: unknown;
}

export function useKnowledgeSourcesQuery(params?: {
  readonly limit?: number;
  readonly cursor?: string;
}) {
  const workspaceId = useWorkspaceQueryScope();
  const query = new URLSearchParams();
  if (params?.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params?.cursor !== undefined) {
    query.set("cursor", params.cursor);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";

  return useQuery({
    queryKey: [
      "knowledge",
      workspaceId,
      "sources",
      params?.limit,
      params?.cursor,
    ],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      consoleFetch<{ items: KnowledgeSourceResource[]; nextCursor?: string }>(
        `/api/v1/knowledge-sources${suffix}`,
      ),
  });
}

export function useKnowledgeSourceQuery(sourceId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["knowledge", workspaceId, "source", sourceId],
    enabled: workspaceId !== undefined && sourceId !== undefined,
    queryFn: () =>
      consoleFetch<KnowledgeSourceResource>(
        `/api/v1/knowledge-sources/${encodeURIComponent(sourceId ?? "")}`,
      ),
  });
}

export function useKnowledgeIndexesQuery(sourceId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["knowledge", workspaceId, "source", sourceId, "indexes"],
    enabled: workspaceId !== undefined && sourceId !== undefined,
    staleTime: 10_000,
    queryFn: () =>
      consoleFetch<{ items: KnowledgeIndexResource[]; nextCursor?: string }>(
        `/api/v1/knowledge-sources/${encodeURIComponent(sourceId ?? "")}/indexes`,
      ),
  });
}

export function useKnowledgeIndexQuery(indexId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["knowledge", workspaceId, "index", indexId],
    enabled: workspaceId !== undefined && indexId !== undefined,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "READY" || status === "FAILED") {
        return false;
      }
      return 5_000;
    },
    queryFn: () =>
      consoleFetch<KnowledgeIndexResource>(
        `/api/v1/knowledge-indexes/${encodeURIComponent(indexId ?? "")}`,
      ),
  });
}

export function useCreateKnowledgeSourceMutation() {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      readonly key: string;
      readonly name: string;
      readonly artifactId: string;
    }) =>
      consoleFetch<KnowledgeSourceResource>("/api/v1/knowledge-sources", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["knowledge", workspaceId],
      });
    },
  });
}

export function useCreateKnowledgeIndexMutation(sourceId: string) {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      consoleFetch<KnowledgeIndexResource>(
        `/api/v1/knowledge-sources/${encodeURIComponent(sourceId)}/indexes`,
        { method: "POST", body: JSON.stringify({}) },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["knowledge", workspaceId],
      });
    },
  });
}

export function useRetryKnowledgeIndexMutation() {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (indexId: string) =>
      consoleFetch<KnowledgeIndexResource>(
        `/api/v1/knowledge-indexes/${encodeURIComponent(indexId)}/retry`,
        { method: "POST", body: JSON.stringify({}) },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["knowledge", workspaceId],
      });
    },
  });
}

export function useKnowledgeRetrieveMutation() {
  return useMutation({
    mutationFn: (body: {
      readonly knowledgeIndexIds: readonly string[];
      readonly query: string;
      readonly topK?: number;
    }) =>
      consoleFetch<{ hits: KnowledgeHitResource[] }>(
        "/api/v1/knowledge/retrieve",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      ),
  });
}

export function useReadyKnowledgeIndexesCatalogQuery(enabled = true) {
  const sourcesQuery = useKnowledgeSourcesQuery({ limit: 50 });
  const workspaceId = useWorkspaceQueryScope();
  const sourceIds = sourcesQuery.data?.items.map((source) => source.id) ?? [];

  return useQuery({
    queryKey: ["knowledge", workspaceId, "ready-catalog", sourceIds.join(",")],
    enabled:
      enabled &&
      workspaceId !== undefined &&
      sourcesQuery.isSuccess &&
      sourceIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const entries: Array<{
        readonly source: KnowledgeSourceResource;
        readonly index: KnowledgeIndexResource;
      }> = [];

      for (const source of sourcesQuery.data?.items ?? []) {
        const page = await consoleFetch<{
          items: KnowledgeIndexResource[];
        }>(
          `/api/v1/knowledge-sources/${encodeURIComponent(source.id)}/indexes`,
        );
        for (const index of page.items) {
          if (index.status === "READY") {
            entries.push({ source, index });
          }
        }
      }

      return entries;
    },
  });
}

export function useMemoryNamespacesQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["memory", workspaceId, "namespaces"],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      consoleFetch<{ items: MemoryNamespaceResource[] }>(
        "/api/v1/memory/namespaces",
      ),
  });
}

export function useMemoryNamespaceQuery(namespaceId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["memory", workspaceId, "namespace", namespaceId],
    enabled: workspaceId !== undefined && namespaceId !== undefined,
    queryFn: () =>
      consoleFetch<MemoryNamespaceResource>(
        `/api/v1/memory/namespaces/${encodeURIComponent(namespaceId ?? "")}`,
      ),
  });
}

export function useMemoryRecordsQuery(
  namespaceId: string | undefined,
  params?: {
    readonly prefix?: string;
    readonly limit?: number;
    readonly cursor?: string;
  },
) {
  const workspaceId = useWorkspaceQueryScope();
  const query = new URLSearchParams();
  if (params?.prefix !== undefined && params.prefix.length > 0) {
    query.set("prefix", params.prefix);
  }
  if (params?.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params?.cursor !== undefined) {
    query.set("cursor", params.cursor);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";

  return useQuery({
    queryKey: [
      "memory",
      workspaceId,
      "records",
      namespaceId,
      params?.prefix,
      params?.limit,
      params?.cursor,
    ],
    enabled: workspaceId !== undefined && namespaceId !== undefined,
    queryFn: () =>
      consoleFetch<{ items: MemoryRecordResource[]; nextCursor?: string }>(
        `/api/v1/memory/namespaces/${encodeURIComponent(namespaceId ?? "")}/records${suffix}`,
      ),
  });
}

export function useCreateMemoryNamespaceMutation() {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { readonly key: string; readonly name: string }) =>
      consoleFetch<MemoryNamespaceResource>("/api/v1/memory/namespaces", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["memory", workspaceId],
      });
    },
  });
}
