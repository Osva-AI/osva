import { Link, useParams } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import {
  useWorkflowQuery,
  useWorkflowVersionsQuery,
} from "../hooks/use-workflows";
import { useWorkflowRunsListQuery } from "../hooks/use-workflow-runs";
import { formatTimestamp } from "../lib/formatting";
import { workflowRunStatusCategory } from "../lib/statuses";
import { ConsoleApiError } from "../lib/console-api";

export function WorkflowDetailPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const workflowQuery = useWorkflowQuery(workflowId);
  const versionsQuery = useWorkflowVersionsQuery(workflowId);
  const runsQuery = useWorkflowRunsListQuery({
    workflowId,
    limit: 10,
  });

  const notFound =
    workflowQuery.isError &&
    workflowQuery.error instanceof ConsoleApiError &&
    workflowQuery.error.status === 404;

  if (workflowId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing workflowId.")}
      />
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Workflow</h1>
          <p className="page-subtitle mono">{workflowId}</p>
        </div>
        <Link className="button" to="/workflows">
          All workflows
        </Link>
      </header>

      {workflowQuery.isLoading ? (
        <LoadingBlock label="Loading workflow…" />
      ) : null}
      {notFound ? (
        <EmptyState
          title="Workflow not found."
          description="This workflow is not visible in the authenticated workspace."
        />
      ) : null}
      {workflowQuery.isError && !notFound ? (
        <ErrorState
          title="Failed to load workflow"
          error={workflowQuery.error}
        />
      ) : null}

      {workflowQuery.data !== undefined ? (
        <section className="panel">
          <dl className="meta-grid">
            <div>
              <dt>Name</dt>
              <dd>{workflowQuery.data.name}</dd>
            </div>
            <div>
              <dt>Key</dt>
              <dd className="mono">{workflowQuery.data.key}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd className="mono">{workflowQuery.data.workspaceId}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatTimestamp(workflowQuery.data.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatTimestamp(workflowQuery.data.updatedAt)}</dd>
            </div>
            {workflowQuery.data.description !== undefined ? (
              <div>
                <dt>Description</dt>
                <dd>{workflowQuery.data.description}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      <section className="panel">
        <h2 className="panel-title">Versions</h2>
        {versionsQuery.isLoading ? (
          <LoadingBlock label="Loading versions…" />
        ) : null}
        {versionsQuery.isError ? (
          <ErrorState
            title="Failed to load versions"
            error={versionsQuery.error}
          />
        ) : null}
        {versionsQuery.data !== undefined &&
        versionsQuery.data.versions.length === 0 ? (
          <EmptyState title="No workflow versions." description="" />
        ) : null}
        {versionsQuery.data !== undefined &&
        versionsQuery.data.versions.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>WorkflowVersion ID</th>
                <th>Schema</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {[...versionsQuery.data.versions]
                .sort((left, right) => right.version - left.version)
                .map((version) => (
                  <tr key={version.id}>
                    <td>{version.version}</td>
                    <td>
                      <Link
                        className="mono"
                        to={`/workflows/${workflowId}/versions/${version.id}`}
                      >
                        {version.id}
                      </Link>
                    </td>
                    <td className="mono">{version.definition.schemaVersion}</td>
                    <td>{formatTimestamp(version.createdAt)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="panel">
        <h2 className="panel-title">Recent WorkflowRuns</h2>
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
          <EmptyState title="No workflow runs yet." description="" />
        ) : null}
        {runsQuery.data !== undefined &&
        runsQuery.data.workflowRuns.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>WorkflowRun ID</th>
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
        ) : null}
      </section>
    </>
  );
}
