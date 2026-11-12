import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { OfficeSectionNav } from "../components/office/office-section-nav";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import { Button, LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useOfficeAssignmentsQuery,
  useOfficeGoalsQuery,
  useOfficeWorkersQuery,
  type OfficeAssignmentResource,
  type OfficeGoalResource,
  type OfficeWorkerResource,
} from "../hooks/use-office";
import { formatTimestamp } from "../lib/formatting";
import {
  assignmentDurationLabel,
  assignmentExecutionPath,
  assignmentsMayHaveStaleListStatus,
  filterOfficeTasks,
  groupAssignmentsByStatus,
  TASK_BOARD_COLUMNS,
  type OfficeTaskBoardFilters,
  type TaskStatusFilter,
} from "../lib/office-task-board";
import { assignmentStatusCategory } from "../lib/office-presentation";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

type ViewMode = "board" | "list";

export function OfficeTasksBoardPage() {
  const authQuery = useAuthContextQuery();
  const assignmentsQuery = useOfficeAssignmentsQuery({
    pollListWhenRunning: true,
  });
  const goalsQuery = useOfficeGoalsQuery();
  const workersQuery = useOfficeWorkersQuery();

  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [filters, setFilters] = useState<OfficeTaskBoardFilters>({
    search: "",
    missionId: "",
    officeWorkerId: "",
    status: "ALL",
  });

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const assignments = assignmentsQuery.data?.items ?? [];
  const goals = goalsQuery.data?.items ?? [];
  const workers = workersQuery.data?.items ?? [];

  const goalById = useMemo(() => {
    const map = new Map<string, OfficeGoalResource>();
    for (const goal of goals) {
      map.set(goal.id, goal);
    }
    return map;
  }, [goals]);

  const workerById = useMemo(() => {
    const map = new Map<string, OfficeWorkerResource>();
    for (const worker of workers) {
      map.set(worker.id, worker);
    }
    return map;
  }, [workers]);

  const filtered = useMemo(
    () => filterOfficeTasks(assignments, filters),
    [assignments, filters],
  );

  const grouped = useMemo(
    () => groupAssignmentsByStatus(filtered),
    [filtered],
  );

  const listRows = useMemo(() => {
    const rows: OfficeAssignmentResource[] = [];
    for (const status of TASK_BOARD_COLUMNS) {
      rows.push(...grouped[status]);
    }
    return rows;
  }, [grouped]);

  const loading =
    assignmentsQuery.isLoading || goalsQuery.isLoading || workersQuery.isLoading;
  const error =
    assignmentsQuery.isError || goalsQuery.isError || workersQuery.isError;
  const loadError =
    (assignmentsQuery.error as Error | undefined) ??
    (goalsQuery.error as Error | undefined) ??
    (workersQuery.error as Error | undefined);

  const staleListNotice = assignmentsMayHaveStaleListStatus(assignments);

  return (
    <div
      className="office-v2 page-stack activity-v2"
      data-testid="office-tasks-board-page"
    >
      <PageHeader
        title="Task Board"
        subtitle="Operational view of workspace assignments. Status on this board reflects persisted list data; use Refresh or open Task Detail for reconciled execution status."
        actions={
          <>
            {canWrite ? (
              <LinkButton variant="primary" to="/office/tasks/new">
                Create Task
              </LinkButton>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              loading={assignmentsQuery.isFetching}
              disabled={assignmentsQuery.isFetching}
              onClick={() => {
                void assignmentsQuery.refetch();
                void goalsQuery.refetch();
                void workersQuery.refetch();
              }}
            >
              Refresh
            </Button>
          </>
        }
      />

      <OfficeSectionNav active="tasks" />

      {staleListNotice ? (
        <p className="form-feedback warn" role="status">
          One or more tasks are RUNNING on the list view. Execution may have
          finished while this board shows a lagging status — use Refresh or open
          the task for a reconciled view.
        </p>
      ) : null}

      <SectionPanel title="Filters">
        <div className="filters">
          <div className="field">
            <label htmlFor="task-board-search">Search</label>
            <input
              id="task-board-search"
              value={filters.search}
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  search: event.target.value,
                }))
              }
              placeholder="Task title"
            />
          </div>
          <div className="field">
            <label htmlFor="task-board-mission">Mission</label>
            <select
              id="task-board-mission"
              value={filters.missionId}
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  missionId: event.target.value,
                }))
              }
            >
              <option value="">All missions</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="task-board-worker">Worker</label>
            <select
              id="task-board-worker"
              value={filters.officeWorkerId}
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  officeWorkerId: event.target.value,
                }))
              }
            >
              <option value="">All workers</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="task-board-status">Status</label>
            <select
              id="task-board-status"
              value={filters.status}
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  status: event.target.value as TaskStatusFilter,
                }))
              }
            >
              <option value="ALL">All statuses</option>
              {TASK_BOARD_COLUMNS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-actions">
          <Button
            type="button"
            variant={viewMode === "board" ? "primary" : "secondary"}
            onClick={() => setViewMode("board")}
          >
            Board
          </Button>
          <Button
            type="button"
            variant={viewMode === "list" ? "primary" : "secondary"}
            onClick={() => setViewMode("list")}
          >
            List
          </Button>
        </div>
      </SectionPanel>

      {loading ? <LoadingBlock label="Loading tasks…" /> : null}

      {error && !loading ? (
        <ErrorState
          title="Failed to load tasks"
          error={loadError ?? new Error("Request failed.")}
        />
      ) : null}

      {!loading && !error && assignments.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Create a PENDING assignment, then launch it when ready."
          action={
            canWrite ? (
              <LinkButton variant="primary" to="/office/tasks/new">
                Create Task
              </LinkButton>
            ) : undefined
          }
        />
      ) : null}

      {!loading && !error && assignments.length > 0 && filtered.length === 0 ? (
        <EmptyState
          title="No tasks match filters"
          description="Adjust search or filters to see assignments."
        />
      ) : null}

      {!loading && !error && filtered.length > 0 && viewMode === "board" ? (
        <div
          className="office-v2-task-board"
          data-testid="office-task-board-columns"
        >
          {TASK_BOARD_COLUMNS.map((status) => (
            <section
              key={status}
              className="office-v2-task-board-column"
              data-testid={`task-column-${status}`}
              aria-label={`${status} tasks`}
            >
              <h2 className="office-v2-task-board-column-title">
                {status}
                <span className="muted">
                  {" "}
                  ({grouped[status].length})
                </span>
              </h2>
              {grouped[status].length === 0 ? (
                <p className="muted">No tasks</p>
              ) : (
                <ul className="office-v2-task-board-cards">
                  {grouped[status].map((assignment) => (
                    <li key={assignment.id}>
                      <TaskCard
                        assignment={assignment}
                        goal={goalById.get(assignment.goalId ?? "")}
                        worker={workerById.get(assignment.officeWorkerId)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : null}

      {!loading && !error && filtered.length > 0 && viewMode === "list" ? (
        <SectionPanel title="All tasks">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Mission</th>
                  <th>Worker</th>
                  <th>Status</th>
                  <th>Target</th>
                  <th>Created</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map((assignment) => (
                  <TaskListRow
                    key={assignment.id}
                    assignment={assignment}
                    goal={goalById.get(assignment.goalId ?? "")}
                    worker={workerById.get(assignment.officeWorkerId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </SectionPanel>
      ) : null}
    </div>
  );
}

function TaskCard(props: {
  readonly assignment: OfficeAssignmentResource;
  readonly goal: OfficeGoalResource | undefined;
  readonly worker: OfficeWorkerResource | undefined;
}) {
  const { assignment, goal, worker } = props;
  const executionLink = assignmentExecutionPath(assignment);

  return (
    <article
      className="office-v2-entity-card office-v2-task-card"
      data-testid={`task-card-${assignment.id}`}
    >
      <h3 className="office-v2-card-title">
        <Link to={`/office/tasks/${assignment.id}`}>{assignment.title}</Link>
      </h3>
      {goal !== undefined ? (
        <p className="office-v2-card-meta">
          Mission{" "}
          <Link to={`/office/missions/${goal.id}`}>{goal.title}</Link>
        </p>
      ) : (
        <p className="office-v2-card-meta muted">Unassigned to a mission</p>
      )}
      <p className="office-v2-card-meta">
        Worker{" "}
        {worker !== undefined ? (
          <Link to={`/office/workers/${worker.id}`}>{worker.name}</Link>
        ) : (
          <span className="mono">{assignment.officeWorkerId}</span>
        )}
      </p>
      <p className="office-v2-card-meta">
        <StatusChip
          status={assignment.status}
          category={assignmentStatusCategory(assignment.status)}
        />
      </p>
      <p className="office-v2-card-meta mono">
        {assignment.targetType === "AGENT_VERSION" ? "Agent" : "Workflow"} ·{" "}
        {assignment.targetVersionId}
      </p>
      <p className="office-v2-card-meta">
        Created {formatTimestamp(assignment.createdAt)}
        {assignment.status !== "PENDING" ? (
          <> · {assignmentDurationLabel(assignment)}</>
        ) : null}
      </p>
      {executionLink !== undefined ? (
        <p className="office-v2-card-meta">
          <Link to={executionLink}>Execution</Link>
        </p>
      ) : null}
    </article>
  );
}

function TaskListRow(props: {
  readonly assignment: OfficeAssignmentResource;
  readonly goal: OfficeGoalResource | undefined;
  readonly worker: OfficeWorkerResource | undefined;
}) {
  const { assignment, goal, worker } = props;

  return (
    <tr data-testid={`task-row-${assignment.id}`}>
      <td>
        <Link to={`/office/tasks/${assignment.id}`}>{assignment.title}</Link>
      </td>
      <td>
        {goal !== undefined ? (
          <Link to={`/office/missions/${goal.id}`}>{goal.title}</Link>
        ) : (
          "—"
        )}
      </td>
      <td>
        {worker !== undefined ? (
          <Link to={`/office/workers/${worker.id}`}>{worker.name}</Link>
        ) : (
          <span className="mono">{assignment.officeWorkerId}</span>
        )}
      </td>
      <td>
        <StatusChip
          status={assignment.status}
          category={assignmentStatusCategory(assignment.status)}
        />
      </td>
      <td className="mono">
        {assignment.targetType === "AGENT_VERSION" ? "Agent" : "Workflow"}
      </td>
      <td>{formatTimestamp(assignment.createdAt)}</td>
      <td>{assignmentDurationLabel(assignment)}</td>
    </tr>
  );
}
