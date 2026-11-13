import { useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { OfficeSectionNav } from "../components/office/office-section-nav";
import { MissionProgressSummary } from "../components/office/mission-progress-summary";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import { Button, LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useOfficeAssignmentsQuery,
  useOfficeGoalQuery,
  useOfficeWorkersQuery,
  useUpdateOfficeGoalMutation,
  type GoalStatus,
  type OfficeAssignmentResource,
  type OfficeWorkerResource,
} from "../hooks/use-office";
import { ConsoleApiError } from "../lib/console-api";
import { formatTimestamp } from "../lib/formatting";
import { computeMissionProgress } from "../lib/mission-progress";
import {
  assignmentStatusCategory,
  goalStatusCategory,
  selectableGoalStatuses,
} from "../lib/office-presentation";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function OfficeMissionDetailPage() {
  const { missionId } = useParams<{ readonly missionId: string }>();
  const [searchParams] = useSearchParams();
  const highlightAssignmentId = searchParams.get("task");

  const authQuery = useAuthContextQuery();
  const goalQuery = useOfficeGoalQuery(missionId);
  const assignmentsQuery = useOfficeAssignmentsQuery();
  const workersQuery = useOfficeWorkersQuery();

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const goal = goalQuery.data;
  const assignments = assignmentsQuery.data?.items ?? [];
  const workers = workersQuery.data?.items ?? [];

  const linkedAssignments = useMemo(() => {
    if (missionId === undefined) {
      return [];
    }
    return assignments.filter((item) => item.goalId === missionId);
  }, [assignments, missionId]);

  const progress = useMemo(
    () =>
      missionId !== undefined
        ? computeMissionProgress(missionId, assignments)
        : undefined,
    [assignments, missionId],
  );

  const workerById = useMemo(() => {
    const map = new Map<string, OfficeWorkerResource>();
    for (const worker of workers) {
      map.set(worker.id, worker);
    }
    return map;
  }, [workers]);

  const responsibleWorkers = useMemo(() => {
    const ids = new Set<string>();
    for (const assignment of linkedAssignments) {
      ids.add(assignment.officeWorkerId);
    }
    return [...ids]
      .map((id) => workerById.get(id))
      .filter((w): w is OfficeWorkerResource => w !== undefined);
  }, [linkedAssignments, workerById]);

  const executionSummary = useMemo(() => {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;
    for (const item of linkedAssignments) {
      switch (item.status) {
        case "PENDING":
          pending += 1;
          break;
        case "RUNNING":
          running += 1;
          break;
        case "COMPLETED":
          completed += 1;
          break;
        case "FAILED":
          failed += 1;
          break;
        default:
          break;
      }
    }
    return { pending, running, completed, failed };
  }, [linkedAssignments]);

  const loading =
    goalQuery.isLoading || assignmentsQuery.isLoading || workersQuery.isLoading;

  if (missionId === undefined) {
    return (
      <ErrorState
        title="Mission not found"
        error={new Error("Missing mission id in route.")}
      />
    );
  }

  return (
    <div
      className="office-v2 page-stack activity-v2"
      data-testid="office-mission-detail-page"
    >
      <PageHeader
        title={goal?.title ?? "Mission"}
        subtitle={
          goal !== undefined
            ? `Mission key ${goal.key} · Created ${formatTimestamp(goal.createdAt)}`
            : "Loading mission…"
        }
        actions={
          <>
            <LinkButton variant="secondary" to="/office/missions">
              All missions
            </LinkButton>
            {canWrite ? (
              <LinkButton
                variant="primary"
                to={`/office/tasks/new?missionId=${encodeURIComponent(missionId)}`}
              >
                Add Task
              </LinkButton>
            ) : null}
          </>
        }
      />

      <OfficeSectionNav active="missions" />

      {loading ? <LoadingBlock label="Loading mission…" /> : null}

      {goalQuery.isError ? (
        <ErrorState
          title="Failed to load mission"
          error={goalQuery.error as Error}
        />
      ) : null}

      {goal !== undefined && progress !== undefined ? (
        <>
          <SectionPanel title="Mission overview">
            <div className="metadata-grid">
              <div>
                <p className="metric-label">Status</p>
                <StatusChip
                  status={goal.status}
                  category={goalStatusCategory(goal.status)}
                />
              </div>
              <div>
                <p className="metric-label">Linked tasks</p>
                <p className="metric-value">{linkedAssignments.length}</p>
              </div>
            </div>
            {goal.description !== undefined ? (
              <p className="office-v2-card-desc">{goal.description}</p>
            ) : null}
            <MissionProgressSummary progress={progress} />
            <ExecutionSummaryRow summary={executionSummary} />
          </SectionPanel>

          {canWrite ? (
            <MissionEditPanel goalId={missionId} goal={goal} />
          ) : (
            <p className="muted">
              Mission metadata is read-only for your workspace role.
            </p>
          )}

          <SectionPanel title="Responsible workers">
            {responsibleWorkers.length === 0 ? (
              <p className="muted">No workers assigned to tasks yet.</p>
            ) : (
              <ul className="office-v2-chip-list">
                {responsibleWorkers.map((worker) => (
                  <li key={worker.id}>
                    <Link
                      className="office-v2-entity-chip"
                      to={`/office/workers/${worker.id}`}
                    >
                      {worker.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionPanel>

          <SectionPanel title="Linked tasks">
            {linkedAssignments.length === 0 ? (
              <p className="muted">No tasks linked to this mission yet.</p>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Title</th>
                      <th scope="col">Worker</th>
                      <th scope="col">Status</th>
                      <th scope="col">Target</th>
                      <th scope="col">Execution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linkedAssignments.map((assignment) => (
                      <AssignmentRow
                        key={assignment.id}
                        assignment={assignment}
                        worker={workerById.get(assignment.officeWorkerId)}
                        highlighted={highlightAssignmentId === assignment.id}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionPanel>
        </>
      ) : null}
    </div>
  );
}

function ExecutionSummaryRow(props: {
  readonly summary: {
    readonly pending: number;
    readonly running: number;
    readonly completed: number;
    readonly failed: number;
  };
}) {
  return (
    <p
      className="muted office-v2-card-meta"
      data-testid="mission-execution-summary"
    >
      Execution: {props.summary.pending} pending, {props.summary.running}{" "}
      running, {props.summary.completed} completed
      {props.summary.failed > 0 ? `, ${props.summary.failed} failed` : null}.{" "}
      Workflow handoff graphs live on each workflow-backed task&apos;s Task
      detail — not aggregated here.
    </p>
  );
}

function MissionEditPanel(props: {
  readonly goalId: string;
  readonly goal: {
    readonly title: string;
    readonly description?: string;
    readonly status: GoalStatus;
  };
}) {
  const updateGoal = useUpdateOfficeGoalMutation(props.goalId);
  const [title, setTitle] = useState(props.goal.title);
  const [description, setDescription] = useState(props.goal.description ?? "");
  const [status, setStatus] = useState<GoalStatus>(props.goal.status);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const statusOptions = selectableGoalStatuses(props.goal.status);

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    setFeedback(undefined);
    setErrorRequestId(undefined);
    setSaved(false);

    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setFeedback("Title is required.");
      return;
    }

    const trimmedDescription = description.trim();
    const body = {
      title: trimmedTitle,
      ...(trimmedDescription.length > 0
        ? { description: trimmedDescription }
        : {}),
      ...(status !== props.goal.status ? { status } : {}),
    };

    try {
      await updateGoal.mutateAsync(body);
      setSaved(true);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Update failed.");
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
      }
    }
  }

  return (
    <SectionPanel title="Edit mission">
      {feedback !== undefined ? (
        <p className="form-feedback error" role="alert">
          {feedback}
          {errorRequestId !== undefined ? (
            <span className="mono"> Request ID: {errorRequestId}</span>
          ) : null}
        </p>
      ) : null}
      {saved ? (
        <p className="form-feedback success" role="status">
          Mission updated.
        </p>
      ) : null}
      <form className="panel" onSubmit={(event) => void submitEdit(event)}>
        <div className="filters">
          <div className="field">
            <label htmlFor="edit-mission-title">Title</label>
            <input
              id="edit-mission-title"
              value={title}
              disabled={updateGoal.isPending}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-mission-status">Goal status</label>
            <select
              id="edit-mission-status"
              value={status}
              disabled={updateGoal.isPending}
              onChange={(event) => setStatus(event.target.value as GoalStatus)}
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="edit-mission-description">Description</label>
          <textarea
            id="edit-mission-description"
            rows={3}
            value={description}
            disabled={updateGoal.isPending}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="form-actions">
          <Button
            type="submit"
            variant="primary"
            loading={updateGoal.isPending}
            disabled={updateGoal.isPending}
          >
            Save changes
          </Button>
        </div>
      </form>
    </SectionPanel>
  );
}

function AssignmentRow(props: {
  readonly assignment: OfficeAssignmentResource;
  readonly worker: OfficeWorkerResource | undefined;
  readonly highlighted: boolean;
}) {
  const executionLink =
    props.assignment.runId !== undefined
      ? `/runs/${props.assignment.runId}`
      : props.assignment.workflowRunId !== undefined
        ? `/workflow-runs/${props.assignment.workflowRunId}`
        : undefined;

  return (
    <tr
      className={props.highlighted ? "is-highlighted-row" : undefined}
      data-testid={`mission-task-${props.assignment.id}`}
    >
      <td>
        <Link to={`/office/tasks/${props.assignment.id}`}>
          {props.assignment.title}
        </Link>
      </td>
      <td>
        {props.worker !== undefined ? (
          <Link to={`/office/workers/${props.worker.id}`}>
            {props.worker.name}
          </Link>
        ) : (
          <span className="mono">{props.assignment.officeWorkerId}</span>
        )}
      </td>
      <td>
        <StatusChip
          status={props.assignment.status}
          category={assignmentStatusCategory(props.assignment.status)}
        />
      </td>
      <td className="mono">
        {props.assignment.targetType === "AGENT_VERSION"
          ? "Agent version"
          : "Workflow version"}
        <span className="muted"> · {props.assignment.targetVersionId}</span>
      </td>
      <td>
        <Link to={`/office/tasks/${props.assignment.id}`}>Task detail</Link>
        {executionLink !== undefined ? (
          <>
            {" "}
            ·{" "}
            <Link className="mono" to={executionLink}>
              Execution
            </Link>
          </>
        ) : (
          <span className="muted"> · Not launched</span>
        )}
      </td>
    </tr>
  );
}
