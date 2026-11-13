import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import type { WorkspaceId } from "@osva-ai/contracts";
import { workspaceScopedFetch } from "../lib/console-api";
import { buildWorkspaceOfficeActivityFeed } from "../lib/office-activity";
import type { OfficeDeliverableWorkflowRunSnapshot } from "../lib/office-deliverable-provenance";
import { useAgentVersionCatalogQuery } from "./use-agents";
import { useOfficeAssignmentsQuery, useOfficeWorkersQuery } from "./use-office";
import type { ArtifactListResource } from "./use-runs";
import { WORKSPACE_ARTIFACT_PAGE_LIMIT } from "./use-workspace-artifacts-page";
import type { WorkflowRunResource } from "./use-workflow-runs";
import type { WorkflowVersionResource } from "./use-workflows";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";
import type { OfficeActivityFilter } from "@osva/domain/office-activity";
import { useQuery } from "@tanstack/react-query";

async function fetchWorkflowRunForActivity(
  workspaceId: string,
  workflowRunId: string,
): Promise<{
  readonly run: WorkflowRunResource;
  readonly snapshot: OfficeDeliverableWorkflowRunSnapshot;
}> {
  const run = await workspaceScopedFetch<WorkflowRunResource>(
    workspaceId,
    `/api/v1/workflow-runs/${encodeURIComponent(workflowRunId)}`,
  );
  const version = await workspaceScopedFetch<WorkflowVersionResource>(
    workspaceId,
    `/api/v1/workflows/${encodeURIComponent(run.workflowId)}/versions/${encodeURIComponent(run.workflowVersionId)}`,
  );
  return {
    run,
    snapshot: {
      workflowRunId: run.id,
      definition: version.definition as never,
      nodeRuns: run.nodeRuns,
    },
  };
}

export function useOfficeActivityFeedQuery(options?: {
  readonly filter?: OfficeActivityFilter;
  readonly pollWhenRunning?: boolean;
  readonly includeArtifacts?: boolean;
}) {
  const workspaceId = useWorkspaceQueryScope();
  const assignmentsQuery = useOfficeAssignmentsQuery({
    pollListWhenRunning: options?.pollWhenRunning ?? true,
  });
  const workersQuery = useOfficeWorkersQuery();
  const catalogQuery = useAgentVersionCatalogQuery(true);

  const assignments = assignmentsQuery.data?.items ?? [];
  const workflowRunIds = useMemo(() => {
    const ids = new Set<string>();
    for (const assignment of assignments) {
      if (assignment.workflowRunId !== undefined) {
        ids.add(assignment.workflowRunId);
      }
    }
    return [...ids].sort();
  }, [assignments]);

  const workflowQueries = useQueries({
    queries: workflowRunIds.map((workflowRunId) => ({
      queryKey: [
        "office",
        workspaceId,
        "activity",
        "workflow-runs",
        workflowRunId,
      ],
      enabled: workspaceId !== undefined && assignmentsQuery.isSuccess,
      staleTime: 60_000,
      queryFn: () => fetchWorkflowRunForActivity(workspaceId!, workflowRunId),
    })),
  });

  const artifactsQuery = useQuery({
    queryKey: ["artifacts", workspaceId, "office-activity-page"],
    enabled:
      workspaceId !== undefined &&
      (options?.includeArtifacts ?? true) &&
      assignmentsQuery.isSuccess,
    staleTime: 60_000,
    queryFn: () =>
      workspaceScopedFetch<ArtifactListResource>(
        workspaceId,
        `/api/v1/artifacts?limit=${WORKSPACE_ARTIFACT_PAGE_LIMIT}`,
      ),
  });

  const workflowRuns = workflowQueries
    .map((query) => query.data?.snapshot)
    .filter(
      (row): row is OfficeDeliverableWorkflowRunSnapshot => row !== undefined,
    );
  const workflowRunResources = workflowQueries
    .map((query) => query.data?.run)
    .filter((row): row is WorkflowRunResource => row !== undefined);

  const feed = useMemo(() => {
    if (workspaceId === undefined) {
      return undefined;
    }
    return buildWorkspaceOfficeActivityFeed({
      workspaceId: workspaceId as WorkspaceId,
      assignments,
      workflowRuns,
      workflowRunResources,
      artifacts: artifactsQuery.data?.items ?? [],
      workers: workersQuery.data?.items ?? [],
      agentVersionCatalog: catalogQuery.data,
      filter: options?.filter,
    });
  }, [
    artifactsQuery.data?.items,
    assignments,
    catalogQuery.data,
    options?.filter,
    workersQuery.data?.items,
    workflowRunResources,
    workflowRuns,
    workspaceId,
  ]);

  const workflowLoading =
    workflowRunIds.length > 0 &&
    workflowQueries.some((query) => query.isLoading);
  const workflowPartialFailure = workflowQueries.some((query) => query.isError);

  return {
    feed,
    assignmentsQuery,
    workersQuery,
    artifactsQuery,
    workflowQueries,
    isLoading:
      assignmentsQuery.isLoading ||
      workersQuery.isLoading ||
      workflowLoading ||
      artifactsQuery.isLoading,
    assignmentsFailed: assignmentsQuery.isError,
    artifactsFailed: artifactsQuery.isError,
    workflowPartialFailure,
    workflowRunsExpected: workflowRunIds.length,
    workflowRunsLoaded: workflowRunResources.length,
    refetchAll: () => {
      void assignmentsQuery.refetch();
      void workersQuery.refetch();
      void artifactsQuery.refetch();
      for (const query of workflowQueries) {
        void query.refetch();
      }
    },
  };
}
