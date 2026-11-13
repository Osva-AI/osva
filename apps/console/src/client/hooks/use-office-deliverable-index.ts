import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import { workspaceScopedFetch } from "../lib/console-api";
import {
  buildOfficeDeliverableProvenanceContext,
  type OfficeDeliverableWorkflowRunSnapshot,
} from "../lib/office-deliverable-provenance";
import { useOfficeAssignmentsQuery } from "./use-office";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";
import type { WorkflowRunResource } from "./use-workflow-runs";
import type { WorkflowVersionResource } from "./use-workflows";

async function fetchWorkflowRunSnapshot(
  workspaceId: string,
  workflowRunId: string,
): Promise<OfficeDeliverableWorkflowRunSnapshot> {
  const run = await workspaceScopedFetch<WorkflowRunResource>(
    workspaceId,
    `/api/v1/workflow-runs/${encodeURIComponent(workflowRunId)}`,
  );
  const version = await workspaceScopedFetch<WorkflowVersionResource>(
    workspaceId,
    `/api/v1/workflows/${encodeURIComponent(run.workflowId)}/versions/${encodeURIComponent(run.workflowVersionId)}`,
  );
  return {
    workflowRunId: run.id,
    definition: version.definition,
    nodeRuns: run.nodeRuns,
  };
}

export function useOfficeDeliverableProvenanceContext() {
  const workspaceId = useWorkspaceQueryScope();
  const assignmentsQuery = useOfficeAssignmentsQuery();
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

  const workflowSnapshotsQuery = useQueries({
    queries: workflowRunIds.map((workflowRunId) => ({
      queryKey: [
        "office",
        workspaceId,
        "deliverables",
        "workflow-runs",
        workflowRunId,
      ],
      enabled: workspaceId !== undefined && assignmentsQuery.isSuccess,
      staleTime: 60_000,
      queryFn: () => fetchWorkflowRunSnapshot(workspaceId!, workflowRunId),
    })),
  });

  const workflowRuns = workflowSnapshotsQuery
    .map((query) => query.data)
    .filter(
      (row): row is OfficeDeliverableWorkflowRunSnapshot => row !== undefined,
    );

  const context = useMemo(
    () => buildOfficeDeliverableProvenanceContext(assignments, workflowRuns),
    [assignments, workflowRuns],
  );

  const workflowLoading =
    workflowRunIds.length > 0 &&
    workflowSnapshotsQuery.some((query) => query.isLoading);

  const workflowPartialFailure = workflowSnapshotsQuery.some(
    (query) => query.isError,
  );

  return {
    assignmentsQuery,
    assignments,
    context,
    workflowRunIds,
    isLoading: assignmentsQuery.isLoading || workflowLoading,
    isError: assignmentsQuery.isError,
    workflowPartialFailure,
    workflowRunsLoaded: workflowRuns.length,
    workflowRunsExpected: workflowRunIds.length,
  };
}
