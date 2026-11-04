import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  ExecutionHistoryList,
  ExecutionHistoryPagination,
  type ExecutionHistoryListRow,
} from "../components/execution/execution-history-list";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { useWorkflowRunsListQuery } from "../hooks/use-workflow-runs";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";
import { buildWorkflowRunHistoryRows } from "../lib/execution-history-feed";

const WORKFLOW_RUN_STATUSES = [
  "",
  "PENDING",
  "RUNNING",
  "WAITING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

const PAGE_LIMIT = 25;

export function WorkflowRunsPage() {
  const workspaceId = useWorkspaceQueryScope();
  const [status, setStatus] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [workflowVersionId, setWorkflowVersionId] = useState("");
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const filters = useMemo(
    () => ({
      status: status || undefined,
      workflowId: workflowId.trim() || undefined,
      workflowVersionId: workflowVersionId.trim() || undefined,
      cursor: cursorStack[cursorStack.length - 1],
      limit: PAGE_LIMIT,
    }),
    [status, workflowId, workflowVersionId, cursorStack],
  );

  const runsQuery = useWorkflowRunsListQuery(filters);
  const nextCursor = runsQuery.data?.nextCursor;
  const workspaceReady = workspaceId !== undefined;

  const rows = useMemo((): readonly ExecutionHistoryListRow[] => {
    return buildWorkflowRunHistoryRows(runsQuery.data?.workflowRuns ?? []).map(
      (row) => ({
        ...row,
        rowClassName: row.isWaiting
          ? "execution-history-v2-row-waiting"
          : undefined,
        waitingHint: row.isWaiting
          ? "Waiting on a workflow step — open the run for details. You may not be able to act unless your role has execute permission."
          : undefined,
      }),
    );
  }, [runsQuery.data?.workflowRuns]);

  const initialLoading =
    workspaceReady && runsQuery.isPending && runsQuery.data === undefined;

  if (!workspaceReady) {
    return (
      <LoadingBlock label="Select a workspace to view workflow run history." />
    );
  }

  return (
    <div
      className="execution-history-v2 page-stack activity-v2"
      data-testid="workflow-runs-history-page"
    >
      <PageHeader
        title="Workflow run history"
        subtitle="Paginated workflow execution history for this workspace."
        actions={
          <>
            {runsQuery.isFetching && !initialLoading ? (
              <span className="muted activity-v2-refresh-hint" role="status">
                Refreshing…
              </span>
            ) : null}
            <button
              type="button"
              className="button"
              onClick={() => void runsQuery.refetch()}
              disabled={runsQuery.isFetching}
            >
              Refresh
            </button>
          </>
        }
      />

      <nav className="activity-v2-history-nav" aria-label="Related views">
        <LinkButton variant="secondary" to="/activity">
          Activity
        </LinkButton>
        <LinkButton variant="secondary" to="/runs">
          Agent run history
        </LinkButton>
      </nav>

      <section className="panel execution-history-v2-filters">
        <div className="filters">
          <div className="field">
            <label htmlFor="wr-status-filter">Status</label>
            <select
              id="wr-status-filter"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setCursorStack([]);
              }}
            >
              {WORKFLOW_RUN_STATUSES.map((value) => (
                <option key={value || "all"} value={value}>
                  {value.length === 0 ? "All statuses" : value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="wr-workflow-id">Workflow ID</label>
            <input
              id="wr-workflow-id"
              value={workflowId}
              onChange={(event) => {
                setWorkflowId(event.target.value);
                setCursorStack([]);
              }}
              placeholder="Filter by workflowId"
            />
          </div>
          <div className="field">
            <label htmlFor="wr-version-id">WorkflowVersion ID</label>
            <input
              id="wr-version-id"
              value={workflowVersionId}
              onChange={(event) => {
                setWorkflowVersionId(event.target.value);
                setCursorStack([]);
              }}
              placeholder="Filter by workflowVersionId"
            />
          </div>
          {(status.length > 0 ||
            workflowId.trim().length > 0 ||
            workflowVersionId.trim().length > 0) && (
            <div className="field execution-history-v2-filter-reset">
              <span className="muted">Filters</span>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setStatus("");
                  setWorkflowId("");
                  setWorkflowVersionId("");
                  setCursorStack([]);
                }}
              >
                Reset filters
              </button>
            </div>
          )}
        </div>
      </section>

      {initialLoading ? <LoadingBlock label="Loading workflow runs…" /> : null}
      {runsQuery.isError ? (
        <ErrorState
          title="Could not load workflow runs"
          error={runsQuery.error}
        />
      ) : null}

      {runsQuery.data !== undefined &&
      rows.length === 0 &&
      !runsQuery.isError ? (
        <EmptyState
          title="No workflow runs yet."
          description="WorkflowRuns created in this workspace will appear here."
          action={
            <Link className="button primary" to="/workflows/new">
              Create workflow
            </Link>
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <>
          <ExecutionHistoryList
            rows={rows}
            listTestId="workflow-runs-history-list"
            ariaLabel="Workflow runs"
          />
          <ExecutionHistoryPagination
            canGoPrevious={cursorStack.length > 0}
            canGoNext={nextCursor !== undefined}
            isFetching={runsQuery.isFetching}
            onPrevious={() => {
              setCursorStack((stack) => stack.slice(0, -1));
            }}
            onNext={() => {
              if (nextCursor !== undefined) {
                setCursorStack((stack) => [...stack, nextCursor]);
              }
            }}
          />
          <p className="muted activity-v2-footnote">
            Ordered by creation time (newest first). Each page shows up to{" "}
            {PAGE_LIMIT} workflow runs.
          </p>
        </>
      ) : null}
    </div>
  );
}
