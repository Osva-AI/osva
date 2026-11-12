import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { TaskDeliverablesSection } from "../components/office/task-deliverables-section";
import { OfficeSectionNav } from "../components/office/office-section-nav";
import { ErrorState } from "../components/error-state/error-state";
import { JsonView } from "../components/json-view/json-view";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import { Button, LinkButton } from "../components/ui/button";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  patchOfficeAssignmentsListCache,
  useCancelOfficeAssignmentMutation,
  useLaunchOfficeAssignmentMutation,
  useOfficeAssignmentQuery,
  useOfficeGoalQuery,
  useOfficeWorkerQuery,
} from "../hooks/use-office";
import { useRunAttemptsQuery, useRunQuery } from "../hooks/use-runs";
import { useWorkflowRunQuery } from "../hooks/use-workflow-runs";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";
import { ConsoleApiError } from "../lib/console-api";
import {
  assignmentDurationLabel,
  assignmentExecutionPath,
} from "../lib/office-task-board";
import { formatTimestamp } from "../lib/formatting";
import { assignmentStatusCategory } from "../lib/office-presentation";
import {
  roleCanExecuteControlPlaneActions,
  roleCanWriteControlPlaneResources,
} from "../lib/permissions";
import { runExecutionStatusLabel } from "../lib/run-execution-labels";
import { runStatusCategory, workflowRunStatusCategory } from "../lib/statuses";
import { workflowRunExecutionStatusLabel } from "../lib/workflow-execution-labels";

export function OfficeTaskDetailPage() {
  const { taskId } = useParams<{ readonly taskId: string }>();
  const navigate = useNavigate();
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  const launchSubmittingRef = useRef(false);

  const authQuery = useAuthContextQuery();
  const assignmentQuery = useOfficeAssignmentQuery(taskId);

  const assignment = assignmentQuery.data;
  const goalQuery = useOfficeGoalQuery(assignment?.goalId);
  const workerQuery = useOfficeWorkerQuery(assignment?.officeWorkerId);

  const launchMutation = useLaunchOfficeAssignmentMutation(taskId ?? "");
  const cancelMutation = useCancelOfficeAssignmentMutation(taskId ?? "");

  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [actionRequestId, setActionRequestId] = useState<string | undefined>();

  useEffect(() => {
    if (assignment !== undefined) {
      patchOfficeAssignmentsListCache(queryClient, workspaceId, assignment);
    }
  }, [assignment, queryClient, workspaceId]);

  const runQuery = useRunQuery(assignment?.runId);
  const attemptsQuery = useRunAttemptsQuery(
    assignment?.runId,
    runQuery.data?.status,
  );
  const workflowRunQuery = useWorkflowRunQuery(assignment?.workflowRunId);

  const latestAttempt = attemptsQuery.data?.attempts.at(-1);
  const executionPath =
    assignment !== undefined ? assignmentExecutionPath(assignment) : undefined;

  if (taskId === undefined) {
    return (
      <ErrorState
        title="Task not found"
        error={new Error("Missing task id in route.")}
      />
    );
  }

  async function confirmLaunch(): Promise<void> {
    if (!canExecute || launchSubmittingRef.current) {
      return;
    }
    setActionError(undefined);
    setActionRequestId(undefined);
    launchSubmittingRef.current = true;
    try {
      const updated = await launchMutation.mutateAsync();
      setLaunchDialogOpen(false);
      patchOfficeAssignmentsListCache(queryClient, workspaceId, updated);
      const path = assignmentExecutionPath(updated);
      if (path !== undefined) {
        navigate(path);
      } else {
        void assignmentQuery.refetch();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Launch failed.");
      if (error instanceof ConsoleApiError) {
        setActionRequestId(error.body.requestId);
      }
    } finally {
      launchSubmittingRef.current = false;
    }
  }

  async function confirmCancel(): Promise<void> {
    if (!canExecute) {
      return;
    }
    setActionError(undefined);
    setActionRequestId(undefined);
    try {
      const updated = await cancelMutation.mutateAsync();
      setCancelDialogOpen(false);
      patchOfficeAssignmentsListCache(queryClient, workspaceId, updated);
      void assignmentQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Cancel failed.");
      if (error instanceof ConsoleApiError) {
        setActionRequestId(error.body.requestId);
      }
    }
  }

  const loading =
    assignmentQuery.isLoading || goalQuery.isLoading || workerQuery.isLoading;

  return (
    <div
      className="office-v2 page-stack activity-v2"
      data-testid="office-task-detail-page"
    >
      <PageHeader
        title={assignment?.title ?? "Task"}
        subtitle={
          assignment !== undefined
            ? `Assignment ${assignment.id} · Created ${formatTimestamp(assignment.createdAt)}`
            : "Loading task…"
        }
        actions={
          <>
            <LinkButton variant="secondary" to="/office/tasks">
              Task Board
            </LinkButton>
            <Button
              type="button"
              variant="secondary"
              loading={assignmentQuery.isFetching}
              disabled={assignmentQuery.isFetching}
              onClick={() => void assignmentQuery.refetch()}
            >
              Refresh
            </Button>
            {canExecute && assignment?.status === "PENDING" ? (
              <>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setLaunchDialogOpen(true)}
                  disabled={launchMutation.isPending}
                >
                  Launch
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => setCancelDialogOpen(true)}
                  disabled={cancelMutation.isPending}
                >
                  Cancel task
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <OfficeSectionNav active="tasks" />

      {loading ? <LoadingBlock label="Loading task…" /> : null}

      {assignmentQuery.isError ? (
        <ErrorState
          title="Failed to load task"
          error={assignmentQuery.error as Error}
        />
      ) : null}

      {actionError !== undefined ? (
        <p className="form-feedback error" role="alert">
          {actionError}
          {actionRequestId !== undefined ? (
            <span className="mono"> Request ID: {actionRequestId}</span>
          ) : null}
        </p>
      ) : null}

      {assignment !== undefined ? (
        <>
          <SectionPanel title="Task information">
            <div className="metadata-grid">
              <div>
                <p className="metric-label">Status</p>
                <StatusChip
                  status={assignment.status}
                  category={assignmentStatusCategory(assignment.status)}
                />
              </div>
              <div>
                <p className="metric-label">Worker</p>
                {workerQuery.data !== undefined ? (
                  <Link to={`/office/workers/${workerQuery.data.id}`}>
                    {workerQuery.data.name}
                  </Link>
                ) : (
                  <span className="mono">{assignment.officeWorkerId}</span>
                )}
              </div>
              <div>
                <p className="metric-label">Mission</p>
                {assignment.goalId !== undefined &&
                goalQuery.data !== undefined ? (
                  <Link to={`/office/missions/${assignment.goalId}`}>
                    {goalQuery.data.title}
                  </Link>
                ) : assignment.goalId !== undefined ? (
                  <span className="mono">{assignment.goalId}</span>
                ) : (
                  "—"
                )}
              </div>
              <div>
                <p className="metric-label">Target</p>
                <p className="mono">
                  {assignment.targetType === "AGENT_VERSION"
                    ? "Agent version"
                    : "Workflow version"}{" "}
                  · {assignment.targetVersionId}
                </p>
              </div>
            </div>
            {assignment.description !== undefined ? (
              <p className="office-v2-card-desc">{assignment.description}</p>
            ) : null}
            <dl className="metadata-grid">
              <div>
                <dt className="metric-label">Started</dt>
                <dd>{formatTimestamp(assignment.startedAt)}</dd>
              </div>
              <div>
                <dt className="metric-label">Completed</dt>
                <dd>{formatTimestamp(assignment.completedAt)}</dd>
              </div>
              <div>
                <dt className="metric-label">Cancelled</dt>
                <dd>{formatTimestamp(assignment.cancelledAt)}</dd>
              </div>
              <div>
                <dt className="metric-label">Duration</dt>
                <dd>{assignmentDurationLabel(assignment)}</dd>
              </div>
            </dl>
            <h3 className="panel-title">Input</h3>
            <JsonView value={assignment.input} />
          </SectionPanel>

          <SectionPanel title="Execution">
            {executionPath === undefined ? (
              <p className="muted">
                Not launched yet. Launch starts a Run or WorkflowRun for this
                worker and target version.
              </p>
            ) : (
              <>
                <p>
                  <Link to={executionPath} data-testid="task-execution-link">
                    Open full execution details
                  </Link>
                </p>
                {assignment.runId !== undefined &&
                runQuery.data !== undefined ? (
                  <RunExecutionSummary
                    status={runQuery.data.status}
                    latestAttemptError={latestAttempt?.error}
                  />
                ) : null}
                {assignment.workflowRunId !== undefined &&
                workflowRunQuery.data !== undefined ? (
                  <WorkflowExecutionSummary
                    status={workflowRunQuery.data.status}
                  />
                ) : null}
              </>
            )}
            <p className="muted">
              In-flight Run cancellation is not available from the Task Board.
              Cancel applies only to PENDING assignments.
            </p>
          </SectionPanel>

          <SectionPanel title="Deliverables">
            <TaskDeliverablesSection assignment={assignment} />
          </SectionPanel>

          {!canWrite ? (
            <p className="muted">
              Your role can view this task but cannot edit task metadata.
            </p>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={launchDialogOpen}
        title="Launch task"
        description={`Launch "${assignment?.title ?? "this task"}" with worker ${workerQuery.data?.name ?? assignment?.officeWorkerId ?? "—"}? Execution will start immediately.`}
        confirmLabel="Launch"
        pending={launchMutation.isPending}
        onConfirm={() => void confirmLaunch()}
        onCancel={() => setLaunchDialogOpen(false)}
      />

      <ConfirmDialog
        open={cancelDialogOpen}
        title="Cancel pending task"
        description="Cancel this PENDING assignment? It will not run and cannot be launched afterward."
        confirmLabel="Cancel task"
        destructive
        pending={cancelMutation.isPending}
        onConfirm={() => void confirmCancel()}
        onCancel={() => setCancelDialogOpen(false)}
      />
    </div>
  );
}

function RunExecutionSummary(props: {
  readonly status: string;
  readonly latestAttemptError:
    { readonly code: string; readonly message: string } | undefined;
}) {
  return (
    <div className="metadata-grid">
      <div>
        <p className="metric-label">Run status</p>
        <StatusChip
          status={runExecutionStatusLabel(props.status)}
          category={runStatusCategory(props.status)}
        />
      </div>
      {props.latestAttemptError !== undefined ? (
        <div>
          <p className="metric-label">Latest attempt error</p>
          <p className="form-feedback error">
            {props.latestAttemptError.code}: {props.latestAttemptError.message}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function WorkflowExecutionSummary(props: { readonly status: string }) {
  return (
    <div className="metadata-grid">
      <div>
        <p className="metric-label">WorkflowRun status</p>
        <StatusChip
          status={workflowRunExecutionStatusLabel(props.status)}
          category={workflowRunStatusCategory(props.status)}
        />
      </div>
    </div>
  );
}
