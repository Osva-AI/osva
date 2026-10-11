import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import { useWorkflowRunsListQuery } from "../hooks/use-workflow-runs";
import { formatTimestamp } from "../lib/formatting";
import { workflowRunStatusCategory } from "../lib/statuses";

const WORKFLOW_RUN_STATUSES = [
  "",
  "PENDING",
  "RUNNING",
  "WAITING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export function WorkflowRunsPage() {
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
      limit: 25,
    }),
    [status, workflowId, workflowVersionId, cursorStack],
  );

  const runsQuery = useWorkflowRunsListQuery(filters);
  const nextCursor = runsQuery.data?.nextCursor;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">WorkflowRuns</h1>
          <p className="page-subtitle">
            Workspace-scoped workflow execution history from OSVA.
          </p>
        </div>
        <button
          type="button"
          className="button"
          onClick={() => void runsQuery.refetch()}
          disabled={runsQuery.isFetching}
        >
          Refresh
        </button>
      </header>

      <section className="panel">
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
        </div>
      </section>

      {runsQuery.isLoading ? (
        <LoadingBlock label="Loading workflow runs…" />
      ) : null}
      {runsQuery.isError ? (
        <ErrorState
          title="Failed to load workflow runs"
          error={runsQuery.error}
        />
      ) : null}

      {runsQuery.data !== undefined &&
      runsQuery.data.workflowRuns.length === 0 ? (
        <EmptyState
          title="No workflow runs yet."
          description="WorkflowRuns created in this workspace will appear here."
        />
      ) : null}

      {runsQuery.data !== undefined &&
      runsQuery.data.workflowRuns.length > 0 ? (
        <section className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>WorkflowRun ID</th>
                <th>Workflow ID</th>
                <th>WorkflowVersion ID</th>
                <th>Status</th>
                <th>Created</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {runsQuery.data.workflowRuns.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link className="mono" to={`/workflow-runs/${run.id}`}>
                      {run.id}
                    </Link>
                  </td>
                  <td className="mono">{run.workflowId}</td>
                  <td className="mono">{run.workflowVersionId}</td>
                  <td>
                    <StatusChip
                      status={run.status}
                      category={workflowRunStatusCategory(run.status)}
                    />
                  </td>
                  <td>{formatTimestamp(run.createdAt)}</td>
                  <td>{formatTimestamp(run.startedAt)}</td>
                  <td>{formatTimestamp(run.completedAt)}</td>
                  <td>{run.error?.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="button"
              disabled={cursorStack.length === 0}
              onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="button"
              disabled={nextCursor === undefined}
              onClick={() => {
                if (nextCursor !== undefined) {
                  setCursorStack((stack) => [...stack, nextCursor]);
                }
              }}
            >
              Next
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
