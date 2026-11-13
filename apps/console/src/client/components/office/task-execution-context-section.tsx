import { Link } from "react-router-dom";
import { useMemo } from "react";

import type {
  AgentBackedExecutionContext,
  OfficeAssignmentExecutionContext,
  WorkflowBackedExecutionContext,
  WorkflowHandoffNodeView,
  WorkflowNodeTimelineEntry,
} from "@osva/domain/office-execution-context";

import { useAgentVersionCatalogQuery } from "../../hooks/use-agents";
import type {
  OfficeAssignmentResource,
  OfficeWorkerResource,
} from "../../hooks/use-office";
import {
  useAllTeamMembershipsQuery,
  useOfficeRolesQuery,
  useOfficeTeamsQuery,
  useOfficeWorkersQuery,
} from "../../hooks/use-office";
import type { RunResource } from "../../hooks/use-runs";
import type { WorkflowRunResource } from "../../hooks/use-workflow-runs";
import { useWorkflowVersionQuery } from "../../hooks/use-workflows";
import {
  buildOfficeAssignmentExecutionContext,
  buildOfficeAssignmentHandoffProjection,
} from "../../lib/office-execution-context";
import {
  buildOfficeTeamContextIndexes,
  flattenTeamMemberships,
} from "../../lib/office-team-context";
import { TaskWorkflowHandoffPanel } from "./task-workflow-handoff-panel";
import { assignmentExecutionPath } from "../../lib/office-task-board";
import { formatTimestamp } from "../../lib/formatting";
import { assignmentStatusCategory } from "../../lib/office-presentation";
import {
  runStatusCategory,
  workflowNodeRunStatusCategory,
  workflowRunStatusCategory,
} from "../../lib/statuses";
import { runExecutionStatusLabel } from "../../lib/run-execution-labels";
import {
  describeWorkflowNodeExecutionStatus,
  workflowRunExecutionStatusLabel,
} from "../../lib/workflow-execution-labels";
import {
  asWorkflowDefinitionView,
  type WorkflowDefinitionView,
} from "../../lib/workflow-definition";
import { resolveWorkflowCanvasLabel } from "../../lib/workflow-canvas-labels";
import { useWorkflowCanvasLabelContext } from "../../hooks/use-workflow-canvas-label-context";
import { StatusChip } from "../status/status-chip";
import { LoadingBlock } from "../loading/loading-block";
import { SectionPanel } from "../ui/section-panel";

interface TaskExecutionContextSectionProps {
  readonly assignment: OfficeAssignmentResource;
  readonly officeWorker: OfficeWorkerResource | undefined;
  readonly run: RunResource | undefined;
  readonly workflowRun: WorkflowRunResource | undefined;
  readonly runLoading: boolean;
  readonly workflowRunLoading: boolean;
}

function executionContextNeedsAgentCatalog(
  assignment: OfficeAssignmentResource,
  workflowRun: WorkflowRunResource | undefined,
): boolean {
  return (
    assignment.workflowRunId !== undefined &&
    workflowRun !== undefined &&
    workflowRun.nodeRuns.some((nodeRun) => nodeRun.status !== "SKIPPED")
  );
}

export function TaskExecutionContextSection({
  assignment,
  officeWorker,
  run,
  workflowRun,
  runLoading,
  workflowRunLoading,
}: TaskExecutionContextSectionProps) {
  const workersQuery = useOfficeWorkersQuery();
  const teamsQuery = useOfficeTeamsQuery();
  const rolesQuery = useOfficeRolesQuery();
  const teamIds = useMemo(
    () => (teamsQuery.data?.items ?? []).map((team) => team.id),
    [teamsQuery.data?.items],
  );
  const membershipQueries = useAllTeamMembershipsQuery(
    assignment.workflowRunId !== undefined ? teamIds : undefined,
  );
  const needsCatalog = executionContextNeedsAgentCatalog(
    assignment,
    workflowRun,
  );
  const catalogQuery = useAgentVersionCatalogQuery(needsCatalog);
  const workflowVersionQuery = useWorkflowVersionQuery(
    workflowRun?.workflowId,
    workflowRun?.workflowVersionId,
  );
  const canvasLabels = useWorkflowCanvasLabelContext();

  const definition = useMemo(
    () =>
      workflowVersionQuery.data?.definition === undefined
        ? undefined
        : asWorkflowDefinitionView(workflowVersionQuery.data.definition),
    [workflowVersionQuery.data?.definition],
  );

  const definitionByKey = useMemo(() => {
    const map = new Map<string, WorkflowDefinitionView["nodes"][number]>();
    if (definition === undefined) {
      return map;
    }
    for (const node of definition.nodes) {
      map.set(node.key, node);
    }
    return map;
  }, [definition]);

  const teamContextIndexes = useMemo(() => {
    if (assignment.workflowRunId === undefined) {
      return undefined;
    }
    const membershipLists = membershipQueries.map((query) => ({
      items: query.data?.items ?? [],
    }));
    const memberships = flattenTeamMemberships(teamIds, membershipLists);
    return buildOfficeTeamContextIndexes({
      teams: teamsQuery.data?.items ?? [],
      roles: rolesQuery.data?.items ?? [],
      memberships,
    });
  }, [
    assignment.workflowRunId,
    membershipQueries,
    rolesQuery.data?.items,
    teamIds,
    teamsQuery.data?.items,
  ]);

  const handoffProjection = useMemo(() => {
    if (workflowRun === undefined || definition === undefined) {
      return undefined;
    }
    return buildOfficeAssignmentHandoffProjection({
      workspaceId: assignment.workspaceId,
      workflowDefinition: definition,
      workflowRun,
      workers: workersQuery.data?.items ?? [],
      agentVersionCatalog: catalogQuery.data,
      teamsById: teamContextIndexes?.teamsById,
      rolesById: teamContextIndexes?.rolesById,
      membershipsByWorkerId: teamContextIndexes?.membershipsByWorkerId,
    });
  }, [
    assignment.workspaceId,
    catalogQuery.data,
    definition,
    teamContextIndexes,
    workflowRun,
    workersQuery.data?.items,
  ]);

  const executionPath = assignmentExecutionPath(assignment);
  const context = useMemo((): OfficeAssignmentExecutionContext | undefined => {
    if (officeWorker === undefined) {
      return undefined;
    }
    return buildOfficeAssignmentExecutionContext({
      assignment,
      officeWorker,
      run,
      workflowRun,
      workflowDefinition: definition,
      workers: workersQuery.data?.items ?? [],
      agentVersionCatalog: catalogQuery.data,
    });
  }, [
    assignment,
    catalogQuery.data,
    definition,
    officeWorker,
    run,
    workflowRun,
    workersQuery.data?.items,
  ]);

  const loadingExtra =
    (assignment.runId !== undefined && runLoading) ||
    (assignment.workflowRunId !== undefined && workflowRunLoading) ||
    (needsCatalog && catalogQuery.isLoading) ||
    (assignment.workflowRunId !== undefined &&
      workflowVersionQuery.isLoading) ||
    (assignment.workflowRunId !== undefined &&
      (teamsQuery.isLoading ||
        rolesQuery.isLoading ||
        membershipQueries.some((query) => query.isLoading)));

  return (
    <SectionPanel title="Execution context">
      {executionPath === undefined ? (
        <p className="muted">
          Not launched yet. Launch starts a Run or WorkflowRun for this worker
          and target version.
        </p>
      ) : (
        <>
          <p>
            <Link to={executionPath} data-testid="task-execution-link">
              Open full execution details
            </Link>
          </p>
          {loadingExtra ? (
            <LoadingBlock label="Loading execution context…" />
          ) : null}
          {context?.kind === "AGENT_RUN" ? (
            <AgentRunExecutionContextView context={context} />
          ) : null}
          {context?.kind === "WORKFLOW_RUN" ? (
            <WorkflowRunExecutionContextView context={context} />
          ) : null}
          {context?.kind === "WORKFLOW_RUN" &&
          handoffProjection !== undefined &&
          definition !== undefined ? (
            <TaskWorkflowHandoffPanel
              projection={handoffProjection}
              definition={definition}
              workflowRunId={context.workflowRunId}
            />
          ) : null}
          {context?.kind === "WORKFLOW_RUN" ? (
            <TaskWorkflowExecutionTimeline
              entries={context.timeline}
              definitionByKey={definitionByKey}
              canvasLabels={canvasLabels}
              workflowRunId={context.workflowRunId}
              handoffByNodeKey={handoffProjection?.nodes}
            />
          ) : null}
        </>
      )}
      <p className="muted">
        Assignment status ({assignment.status}) reflects Office lifecycle
        reconciliation. Node rows below are persisted WorkflowNodeRun records,
        not synthetic handoff events.
      </p>
      <p className="muted">
        In-flight Run cancellation is not available from the Task Board. Cancel
        applies only to PENDING assignments.
      </p>
    </SectionPanel>
  );
}

function AgentRunExecutionContextView(props: {
  readonly context: AgentBackedExecutionContext;
}) {
  return (
    <div className="metadata-grid" data-testid="agent-run-execution-context">
      <div>
        <p className="metric-label">Assignment status</p>
        <StatusChip
          status={props.context.assignmentStatus}
          category={assignmentStatusCategory(props.context.assignmentStatus)}
        />
      </div>
      <div>
        <p className="metric-label">Run status</p>
        <StatusChip
          status={runExecutionStatusLabel(props.context.runStatus)}
          category={runStatusCategory(props.context.runStatus)}
        />
      </div>
      <div>
        <p className="metric-label">Run ID</p>
        <p className="mono">
          <Link to={`/runs/${props.context.runId}`}>{props.context.runId}</Link>
        </p>
      </div>
      <div>
        <p className="metric-label">Run updated</p>
        <p>{formatTimestamp(props.context.runUpdatedAt)}</p>
      </div>
    </div>
  );
}

function WorkflowRunExecutionContextView(props: {
  readonly context: WorkflowBackedExecutionContext;
}) {
  return (
    <div className="metadata-grid" data-testid="workflow-run-execution-context">
      <div>
        <p className="metric-label">Assignment status</p>
        <StatusChip
          status={props.context.assignmentStatus}
          category={assignmentStatusCategory(props.context.assignmentStatus)}
        />
      </div>
      <div>
        <p className="metric-label">WorkflowRun status</p>
        <StatusChip
          status={workflowRunExecutionStatusLabel(
            props.context.workflowRunStatus,
          )}
          category={workflowRunStatusCategory(props.context.workflowRunStatus)}
        />
      </div>
      <div>
        <p className="metric-label">WorkflowRun</p>
        <p className="mono">
          <Link to={`/workflow-runs/${props.context.workflowRunId}`}>
            {props.context.workflowRunId}
          </Link>
        </p>
      </div>
      <div>
        <p className="metric-label">Workflow version</p>
        <p className="mono">{props.context.workflowVersionId}</p>
      </div>
    </div>
  );
}

function TaskWorkflowExecutionTimeline(props: {
  readonly entries: readonly WorkflowNodeTimelineEntry[];
  readonly definitionByKey: Map<
    string,
    WorkflowDefinitionView["nodes"][number]
  >;
  readonly canvasLabels: ReturnType<typeof useWorkflowCanvasLabelContext>;
  readonly workflowRunId: string;
  readonly handoffByNodeKey?: readonly WorkflowHandoffNodeView[];
}) {
  const handoffIndex = useMemo(() => {
    const map = new Map<string, WorkflowHandoffNodeView>();
    for (const row of props.handoffByNodeKey ?? []) {
      map.set(row.workflowNodeKey, row);
    }
    return map;
  }, [props.handoffByNodeKey]);
  if (props.entries.length === 0) {
    return (
      <p className="muted" data-testid="task-execution-timeline-empty">
        No WorkflowNodeRun records yet.
      </p>
    );
  }

  return (
    <div
      className="office-task-execution-timeline"
      data-testid="task-execution-timeline"
    >
      <h3 className="panel-title">Execution timeline</h3>
      <p className="muted">
        Node records in stable execution order (sequence). Navigate to
        WorkflowRun detail for graph view and node inspector.
      </p>
      <ol className="office-task-execution-timeline-list">
        {props.entries.map((entry) => {
          const def = props.definitionByKey.get(entry.workflowNodeKey);
          const handoff = handoffIndex.get(entry.workflowNodeKey);
          const label =
            def === undefined
              ? entry.workflowNodeKey
              : resolveWorkflowCanvasLabel(def as never, props.canvasLabels);
          return (
            <li
              key={entry.workflowNodeRunId}
              className="office-task-execution-timeline-item"
              data-testid={`timeline-node-${entry.workflowNodeKey}`}
            >
              <div className="office-task-execution-timeline-item-head">
                <span className="office-task-execution-timeline-item-title">
                  {label}
                </span>
                <StatusChip
                  status={entry.nodeStatus}
                  category={workflowNodeRunStatusCategory(entry.nodeStatus)}
                  label={describeWorkflowNodeExecutionStatus(entry.nodeStatus)}
                />
              </div>
              <dl className="metadata-grid compact">
                <div>
                  <dt className="metric-label">Node</dt>
                  <dd className="mono">
                    {entry.nodeType ?? "—"} · {entry.workflowNodeKey}
                  </dd>
                </div>
                <div>
                  <dt className="metric-label">Started</dt>
                  <dd>{formatTimestamp(entry.startedAt)}</dd>
                </div>
                <div>
                  <dt className="metric-label">Completed</dt>
                  <dd>{formatTimestamp(entry.completedAt)}</dd>
                </div>
                <div>
                  <dt className="metric-label">Associated OfficeWorker</dt>
                  <dd>
                    <WorkerAttributionSummary
                      attribution={entry.workerAttribution}
                      teamContext={handoff?.teamContext}
                    />
                  </dd>
                </div>
                {entry.selectedBranchTargetKey !== undefined ? (
                  <div>
                    <dt className="metric-label">Selected branch</dt>
                    <dd className="mono">{entry.selectedBranchTargetKey}</dd>
                  </div>
                ) : null}
                {entry.childRunId !== undefined ? (
                  <div>
                    <dt className="metric-label">Child Run</dt>
                    <dd className="mono">
                      <Link to={`/runs/${entry.childRunId}`}>
                        {entry.childRunId}
                      </Link>
                    </dd>
                  </div>
                ) : null}
                {entry.approvalRequestId !== undefined ? (
                  <div>
                    <dt className="metric-label">Approval</dt>
                    <dd>
                      <Link
                        to={`/workflow-runs/${props.workflowRunId}`}
                        data-testid={`timeline-approval-${entry.workflowNodeRunId}`}
                      >
                        {entry.approvalStatus ?? "PENDING"} — open WorkflowRun
                      </Link>
                    </dd>
                  </div>
                ) : null}
              </dl>
              {entry.nodeStatus === "FAILED" ? (
                <p className="form-feedback error" role="status">
                  Node failed. Open WorkflowRun detail for error context.
                </p>
              ) : null}
              {entry.nodeStatus === "WAITING" ? (
                <p className="muted" role="status">
                  Node is waiting. Workers are not kept alive during waits.
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function WorkerAttributionSummary(props: {
  readonly attribution: WorkflowNodeTimelineEntry["workerAttribution"];
  readonly teamContext?: {
    readonly associations: readonly {
      readonly teamId: string;
      readonly teamName: string;
      readonly roleName?: string;
    }[];
  };
}) {
  const teamLine =
    props.teamContext !== undefined &&
    props.teamContext.associations.length > 0 ? (
      <span className="office-worker-team-context muted">
        {" "}
        · Teams:{" "}
        {props.teamContext.associations.map((row, index) => (
          <span key={row.teamId}>
            {index > 0 ? ", " : null}
            <Link to={`/office/teams/${row.teamId}`}>{row.teamName}</Link>
            {row.roleName !== undefined ? ` (${row.roleName})` : null}
          </span>
        ))}{" "}
        (membership only — not node ownership)
      </span>
    ) : null;

  if (props.attribution.kind === "RESOLVED") {
    return (
      <span>
        <Link to={`/office/workers/${props.attribution.officeWorkerId}`}>
          {props.attribution.officeWorkerName}
        </Link>
        {teamLine}
      </span>
    );
  }
  if (props.attribution.agentId !== undefined) {
    return (
      <span>
        Unavailable (
        {props.attribution.reason === "AMBIGUOUS_WORKERS"
          ? "multiple workers share Agent"
          : "no registered worker"}
        ) · Agent{" "}
        <Link to={`/agents/${props.attribution.agentId}`} className="mono">
          {props.attribution.agentId}
        </Link>
        {teamLine}
      </span>
    );
  }
  return <span className="muted">Unavailable{teamLine}</span>;
}
