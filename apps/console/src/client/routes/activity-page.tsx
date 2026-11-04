import { Link } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import { LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { useRunsListQuery } from "../hooks/use-runs";
import { useWorkflowRunsListQuery } from "../hooks/use-workflow-runs";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";
import {
  ACTIVITY_RECENT_LIMIT,
  buildActivityFeedRows,
} from "../lib/activity-feed";
import { ConsoleApiError } from "../lib/console-api";
import { formatActivityTimestamp } from "../lib/formatting";

function describeActivityQueryError(error: unknown, label: string): string {
  if (error instanceof ConsoleApiError) {
    if (error.status === 403) {
      return `${label}: permission denied for your role.`;
    }
    return `${label}: ${error.message}`;
  }
  if (error instanceof Error) {
    return `${label}: ${error.message}`;
  }
  return `${label}: request failed.`;
}

export function ActivityPage() {
  const workspaceId = useWorkspaceQueryScope();
  const runsQuery = useRunsListQuery({ limit: ACTIVITY_RECENT_LIMIT });
  const workflowRunsQuery = useWorkflowRunsListQuery({
    limit: ACTIVITY_RECENT_LIMIT,
  });

  const workspaceReady = workspaceId !== undefined;

  const agentRuns = runsQuery.data?.runs ?? [];
  const workflowRuns = workflowRunsQuery.data?.workflowRuns ?? [];
  const rows = buildActivityFeedRows({ agentRuns, workflowRuns });

  const initialLoading =
    workspaceReady &&
    (runsQuery.isPending || workflowRunsQuery.isPending) &&
    rows.length === 0 &&
    !runsQuery.isError &&
    !workflowRunsQuery.isError;

  const bothFailed = runsQuery.isError && workflowRunsQuery.isError;
  const agentFailed = runsQuery.isError;
  const workflowFailed = workflowRunsQuery.isError;
  const anyPartialFailure =
    (agentFailed && !workflowFailed) || (workflowFailed && !agentFailed);

  const bothSucceededEmpty =
    !agentFailed &&
    !workflowFailed &&
    !runsQuery.isPending &&
    !workflowRunsQuery.isPending &&
    rows.length === 0;

  const refreshing =
    workspaceReady &&
    (runsQuery.isFetching || workflowRunsQuery.isFetching) &&
    !initialLoading;

  function refreshAll(): void {
    void runsQuery.refetch();
    void workflowRunsQuery.refetch();
  }

  if (!workspaceReady) {
    return <LoadingBlock label="Select a workspace to view Activity." />;
  }

  return (
    <div className="activity-v2 page-stack" data-testid="activity-v2-page">
      <PageHeader
        title="Activity"
        subtitle="See what your agents and workflows have been doing."
        actions={
          <>
            {refreshing ? (
              <span className="muted activity-v2-refresh-hint" role="status">
                Refreshing…
              </span>
            ) : null}
            <button
              type="button"
              className="button"
              onClick={refreshAll}
              disabled={runsQuery.isFetching && workflowRunsQuery.isFetching}
            >
              Refresh
            </button>
          </>
        }
      />

      <nav className="activity-v2-history-nav" aria-label="Full run histories">
        <LinkButton variant="secondary" to="/runs">
          Agent run history
        </LinkButton>
        <LinkButton variant="secondary" to="/workflow-runs">
          Workflow run history
        </LinkButton>
      </nav>

      {initialLoading ? (
        <LoadingBlock label="Loading recently created runs…" />
      ) : null}

      {bothFailed ? (
        <>
          <ErrorState
            title="Could not load Activity"
            error={
              runsQuery.error ??
              workflowRunsQuery.error ??
              new Error("Both activity sources failed.")
            }
          />
          <div className="toolbar">
            <button
              type="button"
              className="button primary"
              onClick={refreshAll}
            >
              Try again
            </button>
          </div>
        </>
      ) : null}

      {anyPartialFailure ? (
        <div
          className="activity-v2-degraded"
          role="alert"
          data-testid="activity-partial-failure"
        >
          <p className="activity-v2-degraded-title">Partial activity data</p>
          {agentFailed ? (
            <p className="muted">
              {describeActivityQueryError(runsQuery.error, "Agent run history")}
            </p>
          ) : null}
          {workflowFailed ? (
            <p className="muted">
              {describeActivityQueryError(
                workflowRunsQuery.error,
                "Workflow run history",
              )}
            </p>
          ) : null}
          <div className="toolbar">
            {agentFailed ? (
              <button
                type="button"
                className="button"
                onClick={() => void runsQuery.refetch()}
                disabled={runsQuery.isFetching}
              >
                Retry agent runs
              </button>
            ) : null}
            {workflowFailed ? (
              <button
                type="button"
                className="button"
                onClick={() => void workflowRunsQuery.refetch()}
                disabled={workflowRunsQuery.isFetching}
              >
                Retry workflow runs
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {bothSucceededEmpty ? (
        <EmptyState
          title="No recent activity yet."
          description="Agent runs and workflow runs will appear here after you execute agents or workflows in this workspace."
          action={
            <div className="activity-v2-empty-actions">
              <LinkButton variant="primary" to="/agents/new">
                Create agent
              </LinkButton>
              <LinkButton variant="secondary" to="/workflows/new">
                Create workflow
              </LinkButton>
            </div>
          }
        />
      ) : null}

      {!bothFailed && rows.length > 0 ? (
        <>
          <section
            className="activity-v2-feed home-v2-activity"
            aria-labelledby="activity-feed-title"
            data-testid="activity-recent-feed"
          >
            <div className="home-v2-section-head activity-v2-feed-head">
              <h2 id="activity-feed-title" className="home-v2-section-title">
                Recently created runs
              </h2>
            </div>
            <ul className="home-v2-activity-list">
              {rows.map((row) => {
                const showUpdated = row.updatedAt !== row.createdAt;
                return (
                  <li
                    key={`${row.kind}-${row.id}`}
                    className="home-v2-activity-row activity-v2-feed-row"
                  >
                    <Link
                      to={row.href}
                      className="activity-v2-row-link"
                      aria-label={`${row.title}, ${row.statusLabel}, created ${formatActivityTimestamp(row.createdAt)}`}
                    >
                      <div className="activity-v2-row-leading">
                        <span className="activity-v2-row-title">
                          {row.title}
                        </span>
                        <span className="muted activity-v2-row-meta-line">
                          <span className="activity-v2-type">
                            {row.kind === "agent" ? "Agent" : "Workflow"}
                          </span>
                          <span
                            className="mono activity-v2-row-id"
                            title={row.id}
                          >
                            {row.shortId}
                          </span>
                        </span>
                      </div>
                      <div className="activity-v2-row-trailing">
                        <StatusChip
                          status={row.status}
                          category={row.statusCategory}
                          label={row.statusLabel}
                        />
                        <time
                          className="muted activity-v2-row-time"
                          dateTime={row.createdAt}
                        >
                          Created {formatActivityTimestamp(row.createdAt)}
                        </time>
                        {showUpdated ? (
                          <span className="muted activity-v2-row-time">
                            Updated {formatActivityTimestamp(row.updatedAt)}
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
          <p
            className="muted activity-v2-footnote"
            data-testid="activity-bounded-footnote"
          >
            Shows up to {ACTIVITY_RECENT_LIMIT} recently created agent runs and
            up to {ACTIVITY_RECENT_LIMIT} recently created workflow runs from
            two independent list APIs (ordered by creation time). This is not a
            complete workspace timeline and does not reflect every status
            update.
          </p>
        </>
      ) : null}
    </div>
  );
}
