import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import { workspaceScopedFetch } from "../lib/console-api";
import {
  collectAgentChildRuns,
  collectExplicitArtifactReferences,
  loadWorkflowRunArtifacts,
} from "../lib/workflow-artifacts";
import type { OfficeAssignmentResource } from "./use-office";
import type { ArtifactListResource, ArtifactResource } from "./use-runs";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";
import type { WorkflowRunResource } from "./use-workflow-runs";
import type { WorkflowVersionResource } from "./use-workflows";

export interface MissionDeliverableRow {
  readonly artifact: ArtifactResource;
  readonly assignment: OfficeAssignmentResource;
  readonly truncated: boolean;
}

export interface MissionDeliverablesAggregate {
  readonly rows: readonly MissionDeliverableRow[];
  readonly failures: readonly string[];
  readonly loading: boolean;
  readonly error: boolean;
}

async function loadAssignmentDeliverables(
  workspaceId: string,
  assignment: OfficeAssignmentResource,
): Promise<{
  rows: MissionDeliverableRow[];
  failures: string[];
  truncated: boolean;
}> {
  if (
    assignment.targetType === "AGENT_VERSION" &&
    assignment.runId !== undefined
  ) {
    const page = await workspaceScopedFetch<ArtifactListResource>(
      workspaceId,
      `/api/v1/artifacts?runId=${encodeURIComponent(assignment.runId)}&limit=100`,
    );
    return {
      rows: page.items.map((artifact) => ({
        artifact,
        assignment,
        truncated: false,
      })),
      failures: [],
      truncated: page.nextCursor !== undefined,
    };
  }

  if (
    assignment.targetType === "WORKFLOW_VERSION" &&
    assignment.workflowRunId !== undefined
  ) {
    const run = await workspaceScopedFetch<WorkflowRunResource>(
      workspaceId,
      `/api/v1/workflow-runs/${encodeURIComponent(assignment.workflowRunId)}`,
    );
    const version = await workspaceScopedFetch<WorkflowVersionResource>(
      workspaceId,
      `/api/v1/workflows/${encodeURIComponent(run.workflowId)}/versions/${encodeURIComponent(run.workflowVersionId)}`,
    );
    const childRuns = collectAgentChildRuns(version.definition, run.nodeRuns);
    const referenceIds = collectExplicitArtifactReferences(
      run.nodeRuns
        .map((nodeRun) => nodeRun.output)
        .filter((output): output is unknown => output !== undefined)
        .concat(run.output !== undefined ? [run.output] : []),
    );
    const result = await loadWorkflowRunArtifacts({
      definition: version.definition,
      childRuns,
      referenceIds,
      fetchPage: (path, signal) =>
        workspaceScopedFetch<ArtifactListResource>(workspaceId, path, {
          signal,
        }),
      fetchArtifact: (artifactId, signal) =>
        workspaceScopedFetch<ArtifactResource>(
          workspaceId,
          `/api/v1/artifacts/${encodeURIComponent(artifactId)}`,
          { signal },
        ),
    });
    return {
      rows: result.items.map((artifact) => ({
        artifact,
        assignment,
        truncated: result.truncated,
      })),
      failures: [...result.failures],
      truncated: result.truncated,
    };
  }

  return { rows: [], failures: [], truncated: false };
}

export function useMissionDeliverablesQuery(
  linkedAssignments: readonly OfficeAssignmentResource[],
) {
  const workspaceId = useWorkspaceQueryScope();
  const launched = useMemo(
    () =>
      linkedAssignments.filter(
        (row) => row.runId !== undefined || row.workflowRunId !== undefined,
      ),
    [linkedAssignments],
  );

  const queries = useQueries({
    queries: launched.map((assignment) => ({
      queryKey: [
        "office",
        workspaceId,
        "mission-deliverables",
        assignment.id,
        assignment.runId,
        assignment.workflowRunId,
      ],
      enabled: workspaceId !== undefined,
      staleTime: 60_000,
      queryFn: () => loadAssignmentDeliverables(workspaceId!, assignment),
    })),
  });

  return useMemo((): MissionDeliverablesAggregate => {
    const rows: MissionDeliverableRow[] = [];
    const failures: string[] = [];
    let loading = false;
    let error = false;

    for (const query of queries) {
      if (query.isLoading) {
        loading = true;
      }
      if (query.isError) {
        error = true;
      }
      if (query.data !== undefined) {
        rows.push(...query.data.rows);
        failures.push(...query.data.failures);
      }
    }

    rows.sort((left, right) => {
      const byTime = right.artifact.createdAt.localeCompare(
        left.artifact.createdAt,
      );
      if (byTime !== 0) {
        return byTime;
      }
      return right.artifact.id.localeCompare(left.artifact.id);
    });

    return { rows, failures, loading, error };
  }, [queries]);
}
