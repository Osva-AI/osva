import { RunArtifactsSection } from "../artifact/run-artifacts-section";
import { useArtifactsQuery } from "../../hooks/use-runs";
import { useWorkflowRunArtifactsQuery } from "../../hooks/use-workflow-run-artifacts";
import { useWorkflowVersionQuery } from "../../hooks/use-workflows";
import {
  useWorkflowRunQuery,
  type WorkflowNodeRunResource,
} from "../../hooks/use-workflow-runs";
import { isWorkflowRunLive } from "../../lib/statuses";
import type { OfficeAssignmentResource } from "../../hooks/use-office";

export function TaskDeliverablesSection(props: {
  readonly assignment: OfficeAssignmentResource;
}) {
  const assignment = props.assignment;

  if (assignment.targetType === "AGENT_VERSION" && assignment.runId !== undefined) {
    return (
      <AgentRunDeliverables
        runId={assignment.runId}
        live={assignment.status === "RUNNING"}
      />
    );
  }

  if (
    assignment.targetType === "WORKFLOW_VERSION" &&
    assignment.workflowRunId !== undefined
  ) {
    return (
      <WorkflowRunDeliverables
        workflowRunId={assignment.workflowRunId}
        live={assignment.status === "RUNNING"}
      />
    );
  }

  return (
    <p className="muted">
      Deliverables appear after launch when execution produces artifacts.
    </p>
  );
}

function AgentRunDeliverables(props: {
  readonly runId: string;
  readonly live: boolean;
}) {
  const runQuery = useArtifactsQuery({
    runId: props.runId,
    live: props.live,
  });

  return (
    <RunArtifactsSection
      artifacts={runQuery.data?.items}
      isLoading={runQuery.isLoading}
      isError={runQuery.isError}
      error={runQuery.error}
      live={props.live}
    />
  );
}

function WorkflowRunDeliverables(props: {
  readonly workflowRunId: string;
  readonly live: boolean;
}) {
  const workflowRunQuery = useWorkflowRunQuery(props.workflowRunId);
  const run = workflowRunQuery.data;
  const versionQuery = useWorkflowVersionQuery(
    run?.workflowId,
    run?.workflowVersionId,
  );

  const artifactsLive =
    props.live ||
    (run !== undefined && isWorkflowRunLive(run.status));

  const artifactsQuery = useWorkflowRunArtifactsQuery({
    workflowRunId: props.workflowRunId,
    definition: versionQuery.data?.definition,
    nodeRuns: run?.nodeRuns as readonly WorkflowNodeRunResource[] | undefined,
    workflowOutput: run?.output,
    live: artifactsLive,
  });

  const result = artifactsQuery.data;

  return (
    <RunArtifactsSection
      artifacts={result?.items}
      isLoading={artifactsQuery.isLoading || workflowRunQuery.isLoading}
      isError={artifactsQuery.isError}
      error={artifactsQuery.error}
      live={artifactsLive}
      associations={result?.associations}
      truncated={result?.truncated}
      failures={result?.failures}
    />
  );
}
