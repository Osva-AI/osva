import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { TestingConceptsPanel } from "../components/testing/testing-concepts-panel";
import { TestingSectionNav } from "../components/testing/testing-section-nav";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
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
import {
  describeTestingExecuteRoleRequirement,
  describeTestingWriteRoleRequirement,
  evaluationRunGateHint,
  formatEvaluationRunStatusLabel,
  formatEvaluationTargetSummary,
} from "../lib/testing-resource-presentation";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";

const EVALUATION_RUN_STATUSES = [
  "",
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export function TestingStudioPage() {
  const workspaceId = useWorkspaceQueryScope();
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

  if (workspaceId === undefined) {
    return <LoadingBlock label="Select a workspace to use Testing Studio." />;
  }

  const runsInitialLoading =
    runsQuery.isPending && runsQuery.data === undefined;

  return (
    <div
      className="testing-v2 page-stack activity-v2"
      data-testid="testing-v2-page"
    >
      <PageHeader
        title="Testing Studio"
        subtitle="Try agents in the playground, author evaluation suites, and review batch run history."
        actions={
          <>
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
          </>
        }
      />

      <TestingSectionNav active="hub" canExecute={canExecute} />
      <TestingConceptsPanel />

      {authQuery.isSuccess && !canExecute ? (
        <section className="activity-v2-degraded" role="status">
          <p className="activity-v2-degraded-title">Execute access required</p>
          <p className="muted">{describeTestingExecuteRoleRequirement()}</p>
        </section>
      ) : null}
      {authQuery.isSuccess && !canWrite ? (
        <section className="activity-v2-degraded" role="status">
          <p className="activity-v2-degraded-title">
            Read-only suite authoring
          </p>
          <p className="muted">{describeTestingWriteRoleRequirement()}</p>
        </section>
      ) : null}

      <SectionPanel
        title="Interactive testing"
        description="Single-run checks without publishing a full evaluation batch."
      >
        <div className="toolbar">
          <Link className="button" to="/testing/playground">
            Open Agent playground
          </Link>
        </div>
      </SectionPanel>

      <SectionPanel title="Evaluation suites">
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
            title="No evaluation suites yet"
            description={
              canWrite
                ? "Create a suite, publish an immutable version, then launch a batch evaluation."
                : "Suites created in this workspace will appear here."
            }
          />
        ) : null}
        {suitesQuery.data !== undefined && suitesQuery.data.items.length > 0 ? (
          <DataTableRegion caption="Workspace evaluation suites">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Updated</th>
                <th scope="col">Key</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {suitesQuery.data.items.map((suite) => (
                <tr key={suite.id}>
                  <td>
                    <Link to={`/testing/suites/${suite.id}`}>{suite.name}</Link>
                  </td>
                  <td>{formatTimestamp(suite.updatedAt)}</td>
                  <td>
                    <details className="testing-v2-tech-details">
                      <summary>Show key</summary>
                      <span className="mono">{suite.key}</span>
                    </details>
                  </td>
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
          </DataTableRegion>
        ) : null}
      </SectionPanel>

      <SectionPanel title="Evaluation runs">
        <div className="filters testing-v2-run-filters">
          <div className="field">
            <label htmlFor="er-status-filter">Run status</label>
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
                  {value.length === 0
                    ? "All statuses"
                    : formatEvaluationRunStatusLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="er-suite-filter">Evaluation suite</label>
            <select
              id="er-suite-filter"
              value={evaluationSuiteId}
              onChange={(event) => {
                setEvaluationSuiteId(event.target.value);
                setCursorStack([]);
              }}
            >
              <option value="">All suites</option>
              {(suitesQuery.data?.items ?? []).map((suite) => (
                <option key={suite.id} value={suite.id}>
                  {suite.name}
                </option>
              ))}
            </select>
          </div>
          <details className="testing-v2-tech-details testing-v2-advanced-filters">
            <summary>Advanced filters</summary>
            <div className="field">
              <label htmlFor="er-agent-version-id">Agent version ID</label>
              <input
                id="er-agent-version-id"
                className="mono"
                value={agentVersionId}
                onChange={(event) => {
                  setAgentVersionId(event.target.value);
                  setCursorStack([]);
                }}
                placeholder="Filter by target AgentVersion ID"
              />
            </div>
          </details>
        </div>

        {runsInitialLoading ? (
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
            <DataTableRegion caption="Recent evaluation runs">
              <thead>
                <tr>
                  <th scope="col">Lifecycle</th>
                  <th scope="col">Suite version</th>
                  <th scope="col">Target</th>
                  <th scope="col">Quality gate</th>
                  <th scope="col">Created</th>
                  <th scope="col">Run</th>
                </tr>
              </thead>
              <tbody>
                {runsQuery.data.items.map((evaluationRun) => (
                  <tr key={evaluationRun.id}>
                    <td>
                      <StatusChip
                        status={formatEvaluationRunStatusLabel(
                          evaluationRun.status,
                        )}
                        category={evaluationRunStatusCategory(
                          evaluationRun.status,
                        )}
                      />
                    </td>
                    <td>
                      <details className="testing-v2-tech-details">
                        <summary>View version ID</summary>
                        <span className="mono">
                          {evaluationRun.evaluationSuiteVersionId}
                        </span>
                      </details>
                    </td>
                    <td>{formatEvaluationTargetSummary(evaluationRun)}</td>
                    <td className="muted">
                      {evaluationRunGateHint(evaluationRun.status)}
                    </td>
                    <td>{formatTimestamp(evaluationRun.createdAt)}</td>
                    <td>
                      <Link
                        className="button button-secondary"
                        to={`/testing/runs/${evaluationRun.id}`}
                      >
                        View results
                      </Link>
                      <details className="testing-v2-tech-details">
                        <summary>Run ID</summary>
                        <span className="mono">{evaluationRun.id}</span>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTableRegion>
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
      </SectionPanel>
    </div>
  );
}
