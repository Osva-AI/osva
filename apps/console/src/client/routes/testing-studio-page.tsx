import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useEvaluationRunsListQuery,
  useEvaluationSuitesQuery,
} from "../hooks/use-evaluations";
import { formatTimestamp } from "../lib/formatting";
import {
  roleCanExecuteControlPlaneActions,
  roleCanWriteControlPlaneResources,
} from "../lib/permissions";
import { evaluationRunStatusCategory } from "../lib/evaluation-run-status";

const EVALUATION_RUN_STATUSES = [
  "",
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export function TestingStudioPage() {
  const [status, setStatus] = useState("");
  const [evaluationSuiteId, setEvaluationSuiteId] = useState("");
  const [agentVersionId, setAgentVersionId] = useState("");
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const runFilters = useMemo(
    () => ({
      status: status || undefined,
      evaluationSuiteId: evaluationSuiteId.trim() || undefined,
      agentVersionId: agentVersionId.trim() || undefined,
      cursor: cursorStack[cursorStack.length - 1],
      limit: 25,
    }),
    [status, evaluationSuiteId, agentVersionId, cursorStack],
  );

  const authQuery = useAuthContextQuery();
  const suitesQuery = useEvaluationSuitesQuery();
  const runsQuery = useEvaluationRunsListQuery(runFilters);
  const nextCursor = runsQuery.data?.nextCursor;
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);
  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Testing Studio</h1>
          <p className="page-subtitle">
            Build JSON test suites, publish immutable versions, and review
            evaluation run history for this workspace.
          </p>
        </div>
        <div className="toolbar">
          {canExecute ? (
            <Link className="button primary" to="/testing/runs/new">
              Launch evaluation
            </Link>
          ) : null}
          {canWrite ? (
            <Link className="button" to="/testing/suites/new">
              Create evaluation suite
            </Link>
          ) : null}
          <Link className="button" to="/testing/playground">
            Agent playground
          </Link>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              void suitesQuery.refetch();
              void runsQuery.refetch();
            }}
            disabled={suitesQuery.isFetching || runsQuery.isFetching}
          >
            Refresh
          </button>
        </div>
      </header>

      <section className="panel">
        <h2 className="panel-title">Interactive testing</h2>
        <p className="muted">
          Launch single-agent test Runs, inspect output, and open the canonical
          Run detail without leaving the Console.
        </p>
        <div className="toolbar">
          <Link className="button" to="/testing/playground">
            Open Agent playground
          </Link>
          {canExecute ? (
            <Link className="button" to="/testing/runs/new">
              Launch batch evaluation
            </Link>
          ) : (
            <p className="muted">
              Your workspace role cannot EXECUTE evaluations.
            </p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Evaluation suites</h2>
        {suitesQuery.isLoading ? (
          <LoadingBlock label="Loading evaluation suites…" />
        ) : null}
        {suitesQuery.isError ? (
          <ErrorState
            title="Failed to load evaluation suites"
            error={suitesQuery.error}
          />
        ) : null}
        {suitesQuery.data?.items.length === 0 ? (
          <EmptyState
            title="No evaluation suites yet."
            description={
              canWrite
                ? "Create a suite to author JSON test cases."
                : "Suites created in this workspace will appear here."
            }
          />
        ) : null}
        {suitesQuery.data !== undefined && suitesQuery.data.items.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Name</th>
                <th>Updated</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {suitesQuery.data.items.map((suite) => (
                <tr key={suite.id}>
                  <td className="mono">{suite.key}</td>
                  <td>{suite.name}</td>
                  <td>{formatTimestamp(suite.updatedAt)}</td>
                  <td>
                    <Link
                      className="button button-secondary"
                      to={`/testing/suites/${suite.id}`}
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="panel">
        <h2 className="panel-title">Recent evaluation runs</h2>
        <div className="filters">
          <div className="field">
            <label htmlFor="er-status-filter">Status</label>
            <select
              id="er-status-filter"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setCursorStack([]);
              }}
            >
              {EVALUATION_RUN_STATUSES.map((value) => (
                <option key={value || "all"} value={value}>
                  {value.length === 0 ? "All statuses" : value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="er-suite-id">EvaluationSuite ID</label>
            <input
              id="er-suite-id"
              value={evaluationSuiteId}
              onChange={(event) => {
                setEvaluationSuiteId(event.target.value);
                setCursorStack([]);
              }}
              placeholder="Filter by evaluationSuiteId"
            />
          </div>
          <div className="field">
            <label htmlFor="er-agent-version-id">AgentVersion ID</label>
            <input
              id="er-agent-version-id"
              value={agentVersionId}
              onChange={(event) => {
                setAgentVersionId(event.target.value);
                setCursorStack([]);
              }}
              placeholder="Filter by target agentVersionId"
            />
          </div>
        </div>

        {runsQuery.isLoading ? (
          <LoadingBlock label="Loading evaluation runs…" />
        ) : null}
        {runsQuery.isError ? (
          <ErrorState
            title="Failed to load evaluation runs"
            error={runsQuery.error}
          />
        ) : null}
        {runsQuery.data?.items.length === 0 ? (
          <EmptyState title="No evaluation runs match these filters." />
        ) : null}
        {runsQuery.data !== undefined && runsQuery.data.items.length > 0 ? (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Run ID</th>
                  <th>Suite version</th>
                  <th>Target</th>
                  <th>Created</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {runsQuery.data.items.map((evaluationRun) => (
                  <tr key={evaluationRun.id}>
                    <td>
                      <StatusChip
                        status={evaluationRun.status}
                        category={evaluationRunStatusCategory(
                          evaluationRun.status,
                        )}
                      />
                    </td>
                    <td className="mono">{evaluationRun.id}</td>
                    <td className="mono">
                      {evaluationRun.evaluationSuiteVersionId}
                    </td>
                    <td className="mono">
                      {evaluationRun.targetType} {evaluationRun.targetVersionId}
                    </td>
                    <td>{formatTimestamp(evaluationRun.createdAt)}</td>
                    <td>
                      <Link
                        className="button button-secondary"
                        to={`/testing/runs/${evaluationRun.id}`}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="toolbar">
              <button
                type="button"
                className="button button-secondary"
                disabled={cursorStack.length === 0 || runsQuery.isFetching}
                onClick={() => {
                  setCursorStack((stack) => stack.slice(0, -1));
                }}
              >
                Previous page
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={nextCursor === undefined || runsQuery.isFetching}
                onClick={() => {
                  if (nextCursor !== undefined) {
                    setCursorStack((stack) => [...stack, nextCursor]);
                  }
                }}
              >
                Next page
              </button>
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}
