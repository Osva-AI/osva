import { useQuery } from "@tanstack/react-query";

import { consoleFetch } from "../lib/console-api";
import { ACTIVE_RUN_POLL_MS } from "../lib/query-client";
import { isAttemptLive, isRunLive } from "../lib/statuses";

export interface RunResource {
  readonly id: string;
  readonly agentId: string;
  readonly status: string;
  readonly effectiveBindings: {
    readonly agentVersionId: string;
    readonly modelProfileVersionBindings: Record<string, string>;
    readonly toolVersionBindings: Record<string, string>;
  };
  readonly input: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RunListResource {
  readonly runs: readonly RunResource[];
  readonly nextCursor?: string;
}

export interface RunAttemptResource {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly status: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: { readonly code: string; readonly message: string };
  readonly output?: unknown;
}

export interface RunAttemptListResource {
  readonly attempts: readonly RunAttemptResource[];
}

export interface RunStepResource {
  readonly id: string;
  readonly kind: string;
  readonly bindingName: string;
  readonly status: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly modelProfileVersionId?: string;
  readonly toolVersionId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly estimatedCostUsdMicros?: number | null;
  readonly errorCode?: string;
}

export interface RunStepListResource {
  readonly steps: readonly RunStepResource[];
}

export interface RunAttemptUsageResource {
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens: number;
  readonly estimatedCostUsdMicros: number | null;
  readonly pricedModelCalls: number;
  readonly unpricedModelCalls: number;
}

export interface ArtifactResource {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly digest: string;
  readonly createdAt: string;
  readonly producer?: {
    readonly runId: string;
    readonly runAttemptId: string;
  };
}

export interface ArtifactListResource {
  readonly items: readonly ArtifactResource[];
  readonly nextCursor?: string;
}

export interface ListRunsFilters {
  readonly status?: string;
  readonly agentId?: string;
  readonly agentVersionId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export function useRunsListQuery(filters: ListRunsFilters) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.agentId) params.set("agentId", filters.agentId);
  if (filters.agentVersionId)
    params.set("agentVersionId", filters.agentVersionId);
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));

  const queryString = params.toString();
  const path =
    queryString.length > 0 ? `/api/v1/runs?${queryString}` : "/api/v1/runs";

  return useQuery({
    queryKey: ["runs", "list", filters],
    queryFn: () => consoleFetch<RunListResource>(path),
  });
}

export function useRunQuery(runId: string | undefined) {
  return useQuery({
    queryKey: ["runs", runId],
    enabled: runId !== undefined,
    queryFn: () => consoleFetch<RunResource>(`/api/v1/runs/${runId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && isRunLive(status)
        ? ACTIVE_RUN_POLL_MS
        : false;
    },
  });
}

export function useRunAttemptsQuery(
  runId: string | undefined,
  runStatus?: string,
) {
  return useQuery({
    queryKey: ["runs", runId, "attempts"],
    enabled: runId !== undefined,
    queryFn: () =>
      consoleFetch<RunAttemptListResource>(`/api/v1/runs/${runId}/attempts`),
    refetchInterval:
      runStatus !== undefined && isRunLive(runStatus)
        ? ACTIVE_RUN_POLL_MS
        : false,
  });
}

export function useRunAttemptQuery(
  runId: string | undefined,
  runAttemptId: string | undefined,
  attemptStatus?: string,
) {
  return useQuery({
    queryKey: ["runs", runId, "attempts", runAttemptId],
    enabled: runId !== undefined && runAttemptId !== undefined,
    queryFn: () =>
      consoleFetch<RunAttemptResource>(
        `/api/v1/runs/${runId}/attempts/${runAttemptId}`,
      ),
    refetchInterval:
      attemptStatus !== undefined && isAttemptLive(attemptStatus)
        ? ACTIVE_RUN_POLL_MS
        : false,
  });
}

export function useRunStepsQuery(
  runId: string | undefined,
  runAttemptId: string | undefined,
  attemptStatus?: string,
) {
  return useQuery({
    queryKey: ["runs", runId, "attempts", runAttemptId, "steps"],
    enabled: runId !== undefined && runAttemptId !== undefined,
    queryFn: () =>
      consoleFetch<RunStepListResource>(
        `/api/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      ),
    refetchInterval:
      attemptStatus !== undefined && isAttemptLive(attemptStatus)
        ? ACTIVE_RUN_POLL_MS
        : false,
  });
}

export function useRunUsageQuery(
  runId: string | undefined,
  runAttemptId: string | undefined,
  attemptStatus?: string,
) {
  return useQuery({
    queryKey: ["runs", runId, "attempts", runAttemptId, "usage"],
    enabled: runId !== undefined && runAttemptId !== undefined,
    queryFn: () =>
      consoleFetch<RunAttemptUsageResource>(
        `/api/v1/runs/${runId}/attempts/${runAttemptId}/usage`,
      ),
    refetchInterval:
      attemptStatus !== undefined && isAttemptLive(attemptStatus)
        ? ACTIVE_RUN_POLL_MS
        : false,
  });
}

export function useArtifactsQuery(params: {
  readonly runId?: string;
  readonly runAttemptId?: string;
  readonly live?: boolean;
}) {
  const search = new URLSearchParams();
  if (params.runId) search.set("runId", params.runId);
  if (params.runAttemptId) search.set("runAttemptId", params.runAttemptId);
  const qs = search.toString();
  const path = qs.length > 0 ? `/api/v1/artifacts?${qs}` : "/api/v1/artifacts";

  return useQuery({
    queryKey: ["artifacts", params],
    enabled: params.runId !== undefined || params.runAttemptId !== undefined,
    queryFn: () => consoleFetch<ArtifactListResource>(path),
    refetchInterval: params.live ? ACTIVE_RUN_POLL_MS : false,
  });
}
