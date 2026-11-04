import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  ExecutionHistoryList,
  ExecutionHistoryPagination,
} from "../components/execution/execution-history-list";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { useRunsListQuery } from "../hooks/use-runs";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";
import { buildAgentRunHistoryRows } from "../lib/execution-history-feed";

const RUN_STATUSES = [
  "",
  "PENDING",
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
] as const;

const PAGE_LIMIT = 25;

export function RunsPage() {
  const workspaceId = useWorkspaceQueryScope();
  const [status, setStatus] = useState("");
  const [agentId, setAgentId] = useState("");
  const [agentVersionId, setAgentVersionId] = useState("");
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const filters = useMemo(
    () => ({
      status: status || undefined,
      agentId: agentId.trim() || undefined,
      agentVersionId: agentVersionId.trim() || undefined,
      cursor: cursorStack[cursorStack.length - 1],
      limit: PAGE_LIMIT,
    }),
    [status, agentId, agentVersionId, cursorStack],
  );

  const runsQuery = useRunsListQuery(filters);
  const nextCursor = runsQuery.data?.nextCursor;
  const workspaceReady = workspaceId !== undefined;

  const rows = useMemo(
    () => buildAgentRunHistoryRows(runsQuery.data?.runs ?? []),
    [runsQuery.data?.runs],
  );

  const initialLoading =
    workspaceReady && runsQuery.isPending && runsQuery.data === undefined;

  if (!workspaceReady) {
    return (
      <LoadingBlock label="Select a workspace to view agent run history." />
    );
  }

  return (
    <div
      className="execution-history-v2 page-stack activity-v2"
      data-testid="agent-runs-history-page"
    >
      <PageHeader
        title="Agent run history"
        subtitle="Paginated agent runs in this workspace."
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
        <LinkButton variant="secondary" to="/workflow-runs">
          Workflow run history
        </LinkButton>
      </nav>

      <section className="panel execution-history-v2-filters">
        <div className="filters">
          <div className="field">
            <label htmlFor="status-filter">Status</label>
            <select
              id="status-filter"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setCursorStack([]);
              }}
            >
              {RUN_STATUSES.map((value) => (
                <option key={value || "all"} value={value}>
                  {value.length === 0 ? "All statuses" : value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="agent-id-filter">Agent ID</label>
            <input
              id="agent-id-filter"
              value={agentId}
              onChange={(event) => {
                setAgentId(event.target.value);
                setCursorStack([]);
              }}
              placeholder="Filter by agentId"
            />
          </div>
          <div className="field">
            <label htmlFor="agent-version-filter">Agent version ID</label>
            <input
              id="agent-version-filter"
              value={agentVersionId}
              onChange={(event) => {
                setAgentVersionId(event.target.value);
                setCursorStack([]);
              }}
              placeholder="Filter by agentVersionId"
            />
          </div>
          {(status.length > 0 ||
            agentId.trim().length > 0 ||
            agentVersionId.trim().length > 0) && (
            <div className="field execution-history-v2-filter-reset">
              <span className="muted">Filters</span>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setStatus("");
                  setAgentId("");
                  setAgentVersionId("");
                  setCursorStack([]);
                }}
              >
                Reset filters
              </button>
            </div>
          )}
        </div>
      </section>

      {initialLoading ? <LoadingBlock label="Loading runs…" /> : null}
      {runsQuery.isError ? (
        <ErrorState title="Could not load agent runs" error={runsQuery.error} />
      ) : null}

      {runsQuery.data !== undefined &&
      rows.length === 0 &&
      !runsQuery.isError ? (
        <EmptyState
          title="No runs yet."
          description="Runs created through the OSVA API will appear here."
          action={
            <Link className="button primary" to="/agents/new">
              Create agent
            </Link>
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <>
          <ExecutionHistoryList
            rows={rows}
            listTestId="agent-runs-history-list"
            ariaLabel="Agent runs"
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
            {PAGE_LIMIT} runs. Use filters and pagination to browse the full
            history.
          </p>
        </>
      ) : null}
    </div>
  );
}
