import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { consoleFetch, ConsoleApiError } from "../lib/console-api";
import { ACTIVE_RUN_POLL_MS } from "../lib/query-client";
import { isEvaluationRunLive } from "../lib/evaluation-run-status";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

export interface EvaluationSuiteResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EvaluationSuiteListResource {
  readonly items: readonly EvaluationSuiteResource[];
}

export interface EvaluationCaseResource {
  readonly id: string;
  readonly evaluationSuiteVersionId: string;
  readonly key: string;
  readonly name?: string;
  readonly input: unknown;
  readonly expected?: unknown;
  readonly evaluator: {
    readonly type: "JSON_EXACT_MATCH";
    readonly expected: unknown;
  };
  readonly createdAt: string;
}

export interface EvaluationSuiteVersionResource {
  readonly id: string;
  readonly evaluationSuiteId: string;
  readonly version: number;
  readonly cases: readonly EvaluationCaseResource[];
  readonly createdAt: string;
}

export interface EvaluationSuiteVersionListResource {
  readonly items: readonly EvaluationSuiteVersionResource[];
}

export interface EvaluationRunSummaryResource {
  readonly totalCases: number;
  readonly pendingCases: number;
  readonly runningCases: number;
  readonly completedCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly errorCases: number;
  readonly passRate: number;
  readonly durationMs?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly pricedCostUsdMicros: number;
  readonly unpricedModelCalls: number;
}

export interface EvaluationRunResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly evaluationSuiteVersionId: string;
  readonly targetType: string;
  readonly targetVersionId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
}

export interface EvaluationRunDetailResource extends EvaluationRunResource {
  readonly summary: EvaluationRunSummaryResource;
}

export interface EvaluationCaseResultResource {
  readonly id: string;
  readonly evaluationRunId: string;
  readonly evaluationCaseId: string;
  readonly runId: string;
  readonly outcome: string;
  readonly evaluatorResults: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface EvaluationCaseResultListResource {
  readonly items: readonly EvaluationCaseResultResource[];
}

export interface EvaluationRunListResource {
  readonly items: readonly EvaluationRunResource[];
  readonly nextCursor?: string;
}

export interface ListEvaluationRunsFilters {
  readonly evaluationSuiteId?: string;
  readonly evaluationSuiteVersionId?: string;
  readonly agentVersionId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export function useEvaluationSuitesQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["evaluation-suites", workspaceId, "list"],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      consoleFetch<EvaluationSuiteListResource>("/api/v1/evaluation-suites"),
  });
}

export function useEvaluationSuiteQuery(evaluationSuiteId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["evaluation-suites", workspaceId, evaluationSuiteId],
    enabled: workspaceId !== undefined && evaluationSuiteId !== undefined,
    queryFn: () =>
      consoleFetch<EvaluationSuiteResource>(
        `/api/v1/evaluation-suites/${encodeURIComponent(evaluationSuiteId!)}`,
      ),
  });
}

export function useEvaluationSuiteVersionsQuery(
  evaluationSuiteId: string | undefined,
) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["evaluation-suites", workspaceId, evaluationSuiteId, "versions"],
    enabled: workspaceId !== undefined && evaluationSuiteId !== undefined,
    queryFn: () =>
      consoleFetch<EvaluationSuiteVersionListResource>(
        `/api/v1/evaluation-suites/${encodeURIComponent(evaluationSuiteId!)}/versions`,
      ),
  });
}

export function useEvaluationSuiteVersionQuery(
  evaluationSuiteId: string | undefined,
  evaluationSuiteVersionId: string | undefined,
) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: [
      "evaluation-suites",
      workspaceId,
      evaluationSuiteId,
      "versions",
      evaluationSuiteVersionId,
    ],
    enabled:
      workspaceId !== undefined &&
      evaluationSuiteId !== undefined &&
      evaluationSuiteVersionId !== undefined,
    queryFn: () =>
      consoleFetch<EvaluationSuiteVersionResource>(
        `/api/v1/evaluation-suites/${encodeURIComponent(evaluationSuiteId!)}/versions/${encodeURIComponent(evaluationSuiteVersionId!)}`,
      ),
  });
}

export function evaluationRunRefetchInterval(
  status: string | undefined,
): number | false {
  return status !== undefined && isEvaluationRunLive(status)
    ? ACTIVE_RUN_POLL_MS
    : false;
}

export function useEvaluationRunQuery(evaluationRunId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["evaluation-runs", workspaceId, evaluationRunId],
    enabled: workspaceId !== undefined && evaluationRunId !== undefined,
    queryFn: () =>
      consoleFetch<EvaluationRunDetailResource>(
        `/api/v1/evaluation-runs/${encodeURIComponent(evaluationRunId!)}`,
      ),
    refetchInterval: (query) =>
      evaluationRunRefetchInterval(query.state.data?.status),
  });
}

export function useEvaluationCaseResultsQuery(
  evaluationRunId: string | undefined,
  evaluationRunStatus: string | undefined,
) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["evaluation-runs", workspaceId, evaluationRunId, "case-results"],
    enabled: workspaceId !== undefined && evaluationRunId !== undefined,
    queryFn: () =>
      consoleFetch<EvaluationCaseResultListResource>(
        `/api/v1/evaluation-runs/${encodeURIComponent(evaluationRunId!)}/case-results`,
      ),
    refetchInterval: evaluationRunRefetchInterval(evaluationRunStatus),
  });
}

export interface ResolvedEvaluationSuiteVersion {
  readonly suite: EvaluationSuiteResource;
  readonly version: EvaluationSuiteVersionResource;
}

export function useResolvedEvaluationSuiteVersionQuery(
  evaluationSuiteVersionId: string | undefined,
) {
  const workspaceId = useWorkspaceQueryScope();
  const suitesQuery = useEvaluationSuitesQuery();
  return useQuery({
    queryKey: [
      "evaluation-suites",
      workspaceId,
      "resolve-version",
      evaluationSuiteVersionId,
    ],
    enabled:
      workspaceId !== undefined &&
      evaluationSuiteVersionId !== undefined &&
      suitesQuery.data !== undefined,
    queryFn: async (): Promise<ResolvedEvaluationSuiteVersion> => {
      for (const suite of suitesQuery.data!.items) {
        const versions = await consoleFetch<EvaluationSuiteVersionListResource>(
          `/api/v1/evaluation-suites/${encodeURIComponent(suite.id)}/versions`,
        );
        const version = versions.items.find(
          (item) => item.id === evaluationSuiteVersionId,
        );
        if (version !== undefined) {
          return { suite, version };
        }
      }
      throw new ConsoleApiError(404, {
        error: "Evaluation suite version not found in this workspace.",
      });
    },
  });
}

export function useEvaluationRunsListQuery(filters: ListEvaluationRunsFilters) {
  const workspaceId = useWorkspaceQueryScope();
  const params = new URLSearchParams();
  if (filters.evaluationSuiteId !== undefined) {
    params.set("evaluationSuiteId", filters.evaluationSuiteId);
  }
  if (filters.evaluationSuiteVersionId !== undefined) {
    params.set("evaluationSuiteVersionId", filters.evaluationSuiteVersionId);
  }
  if (filters.agentVersionId !== undefined) {
    params.set("agentVersionId", filters.agentVersionId);
  }
  if (filters.status !== undefined) {
    params.set("status", filters.status);
  }
  if (filters.limit !== undefined) {
    params.set("limit", String(filters.limit));
  }
  if (filters.cursor !== undefined) {
    params.set("cursor", filters.cursor);
  }
  const queryString = params.toString();
  const path =
    queryString.length > 0
      ? `/api/v1/evaluation-runs?${queryString}`
      : "/api/v1/evaluation-runs";

  return useQuery({
    queryKey: ["evaluation-runs", workspaceId, filters],
    enabled: workspaceId !== undefined,
    queryFn: () => consoleFetch<EvaluationRunListResource>(path),
  });
}

export interface CreateEvaluationSuiteInput {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export function useCreateEvaluationSuiteMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (input: CreateEvaluationSuiteInput) =>
      consoleFetch<EvaluationSuiteResource>("/api/v1/evaluation-suites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["evaluation-suites", workspaceId],
      });
    },
  });
}

export interface PublishEvaluationSuiteVersionInput {
  readonly evaluationSuiteId: string;
  readonly cases: readonly {
    readonly key: string;
    readonly name?: string;
    readonly input: unknown;
    readonly expected?: unknown;
    readonly evaluator: {
      readonly type: "JSON_EXACT_MATCH";
      readonly expected: unknown;
    };
  }[];
}

export interface LaunchEvaluationRunInput {
  readonly evaluationSuiteVersionId: string;
  readonly targetVersionId: string;
}

export function useLaunchEvaluationRunMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (input: LaunchEvaluationRunInput) =>
      consoleFetch<EvaluationRunDetailResource>("/api/v1/evaluation-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          evaluationSuiteVersionId: input.evaluationSuiteVersionId,
          targetType: "AGENT_VERSION",
          targetVersionId: input.targetVersionId,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["evaluation-runs", workspaceId],
      });
    },
  });
}

export function usePublishEvaluationSuiteVersionMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (input: PublishEvaluationSuiteVersionInput) =>
      consoleFetch<EvaluationSuiteVersionResource>(
        `/api/v1/evaluation-suites/${encodeURIComponent(input.evaluationSuiteId)}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cases: input.cases }),
        },
      ),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: ["evaluation-suites", workspaceId, input.evaluationSuiteId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["evaluation-suites", workspaceId, "list"],
      });
    },
  });
}
