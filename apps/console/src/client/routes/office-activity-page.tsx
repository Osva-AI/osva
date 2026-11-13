import { useMemo, useState } from "react";

import { OFFICE_ACTIVITY_TYPES } from "@osva/domain/office-activity";
import type {
  OfficeActivityFilter,
  OfficeActivityType,
} from "@osva/domain/office-activity";
import { officeActivityTypeLabel } from "@osva/domain/office-activity";

import { OfficeActivityFeedList } from "../components/office/office-activity-feed";
import { OfficeSectionNav } from "../components/office/office-section-nav";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { PageHeader } from "../components/ui/page-header";
import {
  useOfficeAssignmentsQuery,
  useOfficeGoalsQuery,
  useOfficeWorkersQuery,
} from "../hooks/use-office";
import { useOfficeActivityFeedQuery } from "../hooks/use-office-activity-feed";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";
import { OFFICE_ACTIVITY_RECENT_LIMIT } from "../lib/office-activity";

export function OfficeActivityPage() {
  const workspaceId = useWorkspaceQueryScope();
  const [activityType, setActivityType] = useState<OfficeActivityType | "">("");
  const [missionId, setMissionId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [occurredAfter, setOccurredAfter] = useState("");
  const [occurredBefore, setOccurredBefore] = useState("");

  const filter = useMemo((): OfficeActivityFilter | undefined => {
    const next: {
      activityType?: OfficeActivityType;
      goalId?: string;
      officeWorkerId?: string;
      assignmentId?: string;
      occurredAfter?: string;
      occurredBefore?: string;
    } = {};
    if (activityType !== "") {
      next.activityType = activityType;
    }
    if (missionId.length > 0) {
      next.goalId = missionId;
    }
    if (workerId.length > 0) {
      next.officeWorkerId = workerId;
    }
    if (taskId.length > 0) {
      next.assignmentId = taskId;
    }
    if (occurredAfter.length > 0) {
      next.occurredAfter = new Date(occurredAfter).toISOString();
    }
    if (occurredBefore.length > 0) {
      next.occurredBefore = new Date(occurredBefore).toISOString();
    }
    return Object.keys(next).length > 0
      ? (next as OfficeActivityFilter)
      : undefined;
  }, [
    activityType,
    missionId,
    occurredAfter,
    occurredBefore,
    taskId,
    workerId,
  ]);

  const feedQuery = useOfficeActivityFeedQuery({
    filter,
    pollWhenRunning: true,
    includeArtifacts: true,
  });
  const goalsQuery = useOfficeGoalsQuery();
  const workersQuery = useOfficeWorkersQuery();
  const assignmentsQuery = useOfficeAssignmentsQuery();

  const goalsById = useMemo(
    () =>
      new Map((goalsQuery.data?.items ?? []).map((row) => [row.id, row.title])),
    [goalsQuery.data?.items],
  );
  const workersById = useMemo(
    () =>
      new Map(
        (workersQuery.data?.items ?? []).map((row) => [row.id, row.name]),
      ),
    [workersQuery.data?.items],
  );
  const assignmentsById = useMemo(
    () =>
      new Map(
        (assignmentsQuery.data?.items ?? []).map((row) => [
          row.id,
          { title: row.title, status: row.status },
        ]),
      ),
    [assignmentsQuery.data?.items],
  );

  const initialLoading =
    workspaceId !== undefined &&
    feedQuery.isLoading &&
    feedQuery.feed === undefined;

  const bothCoreFailed =
    feedQuery.assignmentsFailed && feedQuery.artifactsFailed;

  if (workspaceId === undefined) {
    return <LoadingBlock label="Select a workspace to view Office activity." />;
  }

  return (
    <div
      className="office-v2 page-stack activity-v2"
      data-testid="office-activity-page"
    >
      <PageHeader
        title="Office activity"
        subtitle="Read-only timeline of Office tasks, workflow steps, approvals, and verified deliverables."
        actions={
          <>
            {feedQuery.isLoading ? (
              <span className="muted activity-v2-refresh-hint" role="status">
                Refreshing…
              </span>
            ) : null}
            <button
              type="button"
              className="button"
              onClick={() => feedQuery.refetchAll()}
            >
              Refresh
            </button>
          </>
        }
      />
      <OfficeSectionNav active="activity" />

      <section className="toolbar office-activity-filters" aria-label="Filters">
        <label>
          <span className="metric-label">Activity type</span>
          <select
            value={activityType}
            onChange={(event) =>
              setActivityType(event.target.value as OfficeActivityType | "")
            }
          >
            <option value="">All</option>
            {OFFICE_ACTIVITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {officeActivityTypeLabel(type)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="metric-label">Mission</span>
          <select
            value={missionId}
            onChange={(e) => setMissionId(e.target.value)}
          >
            <option value="">All</option>
            {(goalsQuery.data?.items ?? []).map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="metric-label">Worker</span>
          <select
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
          >
            <option value="">All</option>
            {(workersQuery.data?.items ?? []).map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="metric-label">Task</span>
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">All</option>
            {(assignmentsQuery.data?.items ?? []).map((assignment) => (
              <option key={assignment.id} value={assignment.id}>
                {assignment.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="metric-label">After</span>
          <input
            type="datetime-local"
            value={occurredAfter}
            onChange={(e) => setOccurredAfter(e.target.value)}
          />
        </label>
        <label>
          <span className="metric-label">Before</span>
          <input
            type="datetime-local"
            value={occurredBefore}
            onChange={(e) => setOccurredBefore(e.target.value)}
          />
        </label>
      </section>

      {initialLoading ? (
        <LoadingBlock label="Loading Office activity…" />
      ) : null}

      {bothCoreFailed ? (
        <ErrorState
          title="Could not load Office activity"
          error={new Error("Assignment and artifact sources failed.")}
        />
      ) : null}

      {feedQuery.workflowPartialFailure ? (
        <div
          className="activity-v2-degraded"
          role="alert"
          data-testid="office-activity-partial-failure"
        >
          <p className="activity-v2-degraded-title">Partial workflow data</p>
          <p className="muted">
            Some WorkflowRun requests failed. Workflow step and approval entries
            may be missing for affected tasks.
          </p>
        </div>
      ) : null}

      {feedQuery.feed !== undefined &&
      feedQuery.feed.entries.length === 0 &&
      !initialLoading &&
      !bothCoreFailed ? (
        <EmptyState
          title="No Office activity yet."
          description="Create and launch tasks from Mission Control to populate this feed."
        />
      ) : null}

      {feedQuery.feed !== undefined && feedQuery.feed.entries.length > 0 ? (
        <>
          <OfficeActivityFeedList
            entries={feedQuery.feed.entries}
            goalsById={goalsById}
            workersById={workersById}
            assignmentsById={assignmentsById}
          />
          <p
            className="muted activity-v2-footnote"
            data-testid="office-activity-bounded-footnote"
          >
            Shows up to {OFFICE_ACTIVITY_RECENT_LIMIT} recent activity entries
            derived from the workspace assignment list, workflow runs referenced
            by those assignments ({feedQuery.workflowRunsLoaded}/
            {feedQuery.workflowRunsExpected} loaded), and the first page of the
            artifact library. This is not a complete workspace event history.
            {feedQuery.feed.truncated
              ? " Additional older entries were omitted."
              : null}
          </p>
        </>
      ) : null}
    </div>
  );
}
