import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { OfficeSectionNav } from "../components/office/office-section-nav";
import { MissionProgressSummary } from "../components/office/mission-progress-summary";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import { Button, LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useCreateOfficeGoalMutation,
  useOfficeAssignmentsQuery,
  useOfficeGoalsQuery,
  type GoalStatus,
  type OfficeAssignmentResource,
  type OfficeGoalResource,
} from "../hooks/use-office";
import { ConsoleApiError } from "../lib/console-api";
import { formatTimestamp } from "../lib/formatting";
import { computeMissionProgress } from "../lib/mission-progress";
import {
  goalStatusCategory,
  slugOfficeKeyFromName,
} from "../lib/office-presentation";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

type StatusFilter = "ALL" | GoalStatus;

export function OfficeMissionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const authQuery = useAuthContextQuery();
  const goalsQuery = useOfficeGoalsQuery();
  const assignmentsQuery = useOfficeAssignmentsQuery();
  const createGoal = useCreateOfficeGoalMutation();

  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();

  const showCreate = searchParams.get("create") === "1";
  const createdTaskId = searchParams.get("created");

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const goals = goalsQuery.data?.items ?? [];
  const assignments = assignmentsQuery.data?.items ?? [];

  const assignmentCountByGoal = useMemo(() => {
    const map = new Map<string, number>();
    for (const assignment of assignments) {
      if (assignment.goalId === undefined) {
        continue;
      }
      map.set(assignment.goalId, (map.get(assignment.goalId) ?? 0) + 1);
    }
    return map;
  }, [assignments]);

  const filteredGoals = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return goals.filter((goal) => {
      if (statusFilter !== "ALL" && goal.status !== statusFilter) {
        return false;
      }
      if (needle.length === 0) {
        return true;
      }
      return (
        goal.title.toLowerCase().includes(needle) ||
        goal.key.toLowerCase().includes(needle) ||
        (goal.description?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [filter, goals, statusFilter]);

  const loading = goalsQuery.isLoading || assignmentsQuery.isLoading;
  const error = goalsQuery.isError || assignmentsQuery.isError;
  const loadError =
    (goalsQuery.error as Error | undefined) ??
    (assignmentsQuery.error as Error | undefined);

  function closeCreate(): void {
    const next = new URLSearchParams(searchParams);
    next.delete("create");
    setSearchParams(next, { replace: true });
    setFeedback(undefined);
    setErrorRequestId(undefined);
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      return;
    }
    setFeedback(undefined);
    setErrorRequestId(undefined);

    const trimmedKey = key.trim();
    const trimmedTitle = title.trim();
    if (trimmedKey.length === 0 || trimmedTitle.length === 0) {
      setFeedback("Mission key and title are required.");
      return;
    }

    try {
      const goal = await createGoal.mutateAsync({
        key: trimmedKey,
        title: trimmedTitle,
        ...(description.trim().length > 0
          ? { description: description.trim() }
          : {}),
      });
      closeCreate();
      navigate(`/office/missions/${goal.id}`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Create failed.");
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
      }
    }
  }

  return (
    <div
      className="office-v2 page-stack activity-v2"
      data-testid="office-missions-page"
    >
      <PageHeader
        title="Missions"
        subtitle="Missions group tasks under shared goals. Progress is derived from linked assignments; completing all tasks does not automatically close a mission."
        actions={
          <>
            {canWrite ? (
              <LinkButton variant="primary" to="/office/missions?create=1">
                Create Mission
              </LinkButton>
            ) : null}
            <LinkButton variant="secondary" to="/office/tasks/new">
              Create Task
            </LinkButton>
            <Button
              type="button"
              variant="secondary"
              loading={goalsQuery.isFetching}
              disabled={goalsQuery.isFetching}
              onClick={() => {
                void goalsQuery.refetch();
                void assignmentsQuery.refetch();
              }}
            >
              Refresh
            </Button>
          </>
        }
      />

      <OfficeSectionNav active="missions" />

      {createdTaskId !== null ? (
        <p className="form-feedback success" role="status">
          Task <span className="mono">{createdTaskId}</span> created in PENDING
          state (no execution started).
        </p>
      ) : null}

      {!canWrite ? (
        <p className="muted">
          Creating and editing missions requires a DEVELOPER, ADMIN, or OWNER
          role.
        </p>
      ) : null}

      {loading ? <LoadingBlock label="Loading missions…" /> : null}

      {error && !loading ? (
        <ErrorState title="Failed to load missions" error={loadError} />
      ) : null}

      {!loading && !error ? (
        <>
          <div className="filters">
            <div className="field">
              <label htmlFor="mission-search">Search</label>
              <input
                id="mission-search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Title, key, or description"
              />
            </div>
            <div className="field">
              <label htmlFor="mission-status-filter">Status</label>
              <select
                id="mission-status-filter"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
              >
                <option value="ALL">All statuses</option>
                <option value="OPEN">Open</option>
                <option value="ACTIVE">Active</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>

          {showCreate && canWrite ? (
            <SectionPanel title="Create Mission">
              {feedback !== undefined ? (
                <p className="form-feedback error" role="alert">
                  {feedback}
                  {errorRequestId !== undefined ? (
                    <span className="mono"> Request ID: {errorRequestId}</span>
                  ) : null}
                </p>
              ) : null}
              <form
                className="panel"
                onSubmit={(event) => void submitCreate(event)}
              >
                <div className="filters">
                  <div className="field">
                    <label htmlFor="mission-title">Title</label>
                    <input
                      id="mission-title"
                      value={title}
                      disabled={createGoal.isPending}
                      onChange={(event) => {
                        const next = event.target.value;
                        setTitle(next);
                        if (!keyTouched) {
                          setKey(slugOfficeKeyFromName(next));
                        }
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="mission-key">Mission key</label>
                    <input
                      id="mission-key"
                      value={key}
                      disabled={createGoal.isPending}
                      onChange={(event) => {
                        setKey(event.target.value);
                        setKeyTouched(true);
                      }}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="mission-description">Description</label>
                  <textarea
                    id="mission-description"
                    rows={3}
                    value={description}
                    disabled={createGoal.isPending}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </div>
                <div className="form-actions">
                  <Button
                    type="submit"
                    variant="primary"
                    loading={createGoal.isPending}
                    disabled={createGoal.isPending}
                  >
                    Create Mission
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={createGoal.isPending}
                    onClick={closeCreate}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </SectionPanel>
          ) : null}

          {goals.length === 0 ? (
            <EmptyState
              title="No missions yet"
              description="Create a mission to organize tasks around a shared objective."
              action={
                canWrite ? (
                  <LinkButton variant="primary" to="/office/missions?create=1">
                    Create Mission
                  </LinkButton>
                ) : undefined
              }
            />
          ) : filteredGoals.length === 0 ? (
            <p className="muted">No missions match your filters.</p>
          ) : (
            <ul className="office-v2-card-grid">
              {filteredGoals.map((goal) => (
                <MissionCard
                  key={goal.id}
                  goal={goal}
                  assignmentCount={assignmentCountByGoal.get(goal.id) ?? 0}
                  assignments={assignments}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

function MissionCard(props: {
  readonly goal: OfficeGoalResource;
  readonly assignmentCount: number;
  readonly assignments: readonly OfficeAssignmentResource[];
}) {
  const progress = computeMissionProgress(props.goal.id, props.assignments);

  return (
    <li
      className="office-v2-entity-card"
      data-testid={`mission-card-${props.goal.id}`}
    >
      <h3 className="office-v2-card-title">
        <Link to={`/office/missions/${props.goal.id}`}>{props.goal.title}</Link>
      </h3>
      {props.goal.description !== undefined ? (
        <p className="muted office-v2-card-desc">{props.goal.description}</p>
      ) : null}
      <p className="office-v2-card-meta">
        <StatusChip
          status={props.goal.status}
          category={goalStatusCategory(props.goal.status)}
        />
        <span className="muted">
          {" "}
          · {props.assignmentCount} task{props.assignmentCount === 1 ? "" : "s"}
        </span>
      </p>
      <MissionProgressSummary progress={progress} />
      <p className="muted office-v2-card-meta">
        Updated {formatTimestamp(props.goal.updatedAt)}
      </p>
    </li>
  );
}
