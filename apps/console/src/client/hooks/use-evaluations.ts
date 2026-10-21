import { useQuery } from "@tanstack/react-query";

import { consoleFetch } from "../lib/console-api";

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
  return useQuery({
    queryKey: ["evaluation-suites"],
    queryFn: () =>
      consoleFetch<EvaluationSuiteListResource>("/api/v1/evaluation-suites"),
  });
}

export function useEvaluationRunsListQuery(filters: ListEvaluationRunsFilters) {
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
    queryKey: ["evaluation-runs", filters],
    queryFn: () => consoleFetch<EvaluationRunListResource>(path),
  });
}
