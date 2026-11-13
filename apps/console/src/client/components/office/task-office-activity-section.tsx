import { useMemo } from "react";

import type { WorkspaceId } from "@osva-ai/contracts";

import type { OfficeAssignmentResource } from "../../hooks/use-office";
import {
  useOfficeAssignmentsQuery,
  useOfficeWorkersQuery,
} from "../../hooks/use-office";
import { useAgentVersionCatalogQuery } from "../../hooks/use-agents";
import { useArtifactsQuery } from "../../hooks/use-runs";
import { useWorkflowRunArtifactsQuery } from "../../hooks/use-workflow-run-artifacts";
import type { WorkflowRunResource } from "../../hooks/use-workflow-runs";
import { buildTaskDetailOfficeActivityTimeline } from "../../lib/office-activity";
import { workflowDefinitionToExecutionNodes } from "../../lib/office-execution-context";
import type { RunResource } from "../../hooks/use-runs";
import type { WorkflowDefinitionView } from "../../lib/workflow-definition";
import { OfficeActivityFeedList } from "./office-activity-feed";
import { SectionPanel } from "../ui/section-panel";
import { LoadingBlock } from "../loading/loading-block";

interface TaskOfficeActivitySectionProps {
  readonly assignment: OfficeAssignmentResource;
  readonly run: RunResource | undefined;
  readonly workflowRun: WorkflowRunResource | undefined;
  readonly workflowDefinition: WorkflowDefinitionView | undefined;
}

export function TaskOfficeActivitySection({
  assignment,
  run,
  workflowRun,
  workflowDefinition,
}: TaskOfficeActivitySectionProps) {
  const assignmentsQuery = useOfficeAssignmentsQuery();
  const workersQuery = useOfficeWorkersQuery();
  const catalogQuery = useAgentVersionCatalogQuery(
    assignment.workflowRunId !== undefined,
  );
  const runArtifactsQuery = useArtifactsQuery({
    runId: assignment.runId,
    live: assignment.status === "RUNNING",
  });
  const workflowArtifactsQuery = useWorkflowRunArtifactsQuery({
    workflowRunId: assignment.workflowRunId,
    definition: workflowDefinition,
    nodeRuns: workflowRun?.nodeRuns,
    workflowOutput: workflowRun?.output,
    live: assignment.status === "RUNNING",
  });

  const entries = useMemo(() => {
    if (assignmentsQuery.data === undefined) {
      return [];
    }
    const workflowRuns =
      workflowRun === undefined
        ? []
        : [
            {
              workflowRunId: workflowRun.id,
              definition: workflowDefinition,
              nodeRuns: workflowRun.nodeRuns,
            },
          ];
    return buildTaskDetailOfficeActivityTimeline({
      workspaceId: assignment.workspaceId as WorkspaceId,
      assignment,
      workflowRun,
      workflowDefinitionNodes:
        workflowDefinitionToExecutionNodes(workflowDefinition),
      run,
      artifacts: [
        ...(runArtifactsQuery.data?.items ?? []),
        ...(workflowArtifactsQuery.data?.items ?? []),
      ],
      workflowRuns,
      allAssignments: assignmentsQuery.data.items,
      workers: workersQuery.data?.items ?? [],
      agentVersionCatalog: catalogQuery.data,
    });
  }, [
    assignment,
    assignmentsQuery.data,
    catalogQuery.data,
    run,
    runArtifactsQuery.data?.items,
    workflowArtifactsQuery.data?.items,
    workflowDefinition,
    workflowRun,
    workersQuery.data?.items,
  ]);

  const workersById = useMemo(
    () =>
      new Map(
        (workersQuery.data?.items ?? []).map((row) => [row.id, row.name]),
      ),
    [workersQuery.data?.items],
  );

  const assignmentsById = useMemo(
    () =>
      new Map([
        [assignment.id, { title: assignment.title, status: assignment.status }],
      ]),
    [assignment.id, assignment.status, assignment.title],
  );

  const loading =
    assignmentsQuery.isLoading ||
    workersQuery.isLoading ||
    (assignment.workflowRunId !== undefined && catalogQuery.isLoading) ||
    (assignment.runId !== undefined && runArtifactsQuery.isLoading) ||
    (assignment.workflowRunId !== undefined &&
      workflowDefinition !== undefined &&
      workflowArtifactsQuery.isLoading);

  return (
    <SectionPanel title="Office activity timeline">
      <p className="muted">
        Chronological view of assignment lifecycle, persisted workflow steps,
        human approvals, and verified deliverables for this task. Workflow step
        ordering remains available in Execution context above; this list merges
        all verified sources without synthetic handoffs.
      </p>
      {loading ? <LoadingBlock label="Loading activity timeline…" /> : null}
      {!loading ? (
        <OfficeActivityFeedList
          entries={entries}
          goalsById={new Map()}
          workersById={workersById}
          assignmentsById={assignmentsById}
          testId="task-office-activity-timeline"
        />
      ) : null}
    </SectionPanel>
  );
}
