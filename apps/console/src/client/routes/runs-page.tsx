import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import { useRunsListQuery } from "../hooks/use-runs";
import { formatTimestamp } from "../lib/formatting";
import { runStatusCategory } from "../lib/statuses";

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

export function RunsPage() {
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
      limit: 25,
    }),
    [status, agentId, agentVersionId, cursorStack],
  );

  const runsQuery = useRunsListQuery(filters);
  const nextCursor = runsQuery.data?.nextCursor;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Runs</h1>
          <p className="page-subtitle">
            Individual Runs from the OSVA control plane. Launch from an
            AgentVersion; this list is not WorkflowRuns.
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
        </div>
      </section>

      {runsQuery.isLoading ? <LoadingBlock label="Loading runs…" /> : null}
      {runsQuery.isError ? (
        <ErrorState title="Failed to load runs" error={runsQuery.error} />
      ) : null}

      {runsQuery.data !== undefined && runsQuery.data.runs.length === 0 ? (
        <EmptyState
          title="No runs yet."
          description="Runs created through the OSVA API will appear here."
        />
      ) : null}

      {runsQuery.data !== undefined && runsQuery.data.runs.length > 0 ? (
        <section className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Agent ID</th>
                <th>Status</th>
                <th>Agent version</th>
                <th>Created</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {runsQuery.data.runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link className="mono" to={`/runs/${run.id}`}>
                      {run.id}
                    </Link>
                  </td>
                  <td className="mono">{run.agentId}</td>
                  <td>
                    <StatusChip
                      status={run.status}
                      category={runStatusCategory(run.status)}
                    />
                  </td>
                  <td className="mono">
                    {run.effectiveBindings.agentVersionId}
                  </td>
                  <td>{formatTimestamp(run.createdAt)}</td>
                  <td>{formatTimestamp(run.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="button"
              disabled={cursorStack.length === 0}
              onClick={() => {
                setCursorStack((stack) => stack.slice(0, -1));
              }}
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
