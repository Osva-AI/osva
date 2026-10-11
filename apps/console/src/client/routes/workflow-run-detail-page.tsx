import { Link, useParams } from "react-router-dom";

import { WorkflowNodeExecutionCard } from "../components/workflow/workflow-node-execution-card";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { JsonView } from "../components/json-view/json-view";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { useWorkflowVersionQuery } from "../hooks/use-workflows";
import { useWorkflowRunQuery } from "../hooks/use-workflow-runs";
import { orderWorkflowNodeKeys } from "../lib/workflow-definition";
import { roleCanExecuteControlPlaneActions } from "../lib/permissions";
import { formatTimestamp } from "../lib/formatting";
import { workflowRunStatusCategory } from "../lib/statuses";
import { ConsoleApiError } from "../lib/console-api";

export function WorkflowRunDetailPage() {
  const { workflowRunId } = useParams<{ workflowRunId: string }>();
  const authQuery = useAuthContextQuery();
  const runQuery = useWorkflowRunQuery(workflowRunId);
  const versionQuery = useWorkflowVersionQuery(
    runQuery.data?.workflowId,
    runQuery.data?.workflowVersionId,
  );

  const notFound =
    runQuery.isError &&
    runQuery.error instanceof ConsoleApiError &&
    runQuery.error.status === 404;

  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);

  if (workflowRunId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing workflowRunId.")}
      />
    );
  }

  const definition = versionQuery.data?.definition;
  const nodeRunByKey = new Map(
    (runQuery.data?.nodeRuns ?? []).map((nodeRun) => [
      nodeRun.workflowNodeKey,
      nodeRun,
    ]),
  );
  const approvalByNodeRunId = new Map(
    (runQuery.data?.approvalRequests ?? []).map((request) => [
      request.workflowNodeRunId,
      request,
    ]),
  );

  const orderedKeys =
    definition === undefined ? [] : orderWorkflowNodeKeys(definition);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">WorkflowRun</h1>
          <p className="page-subtitle mono">{workflowRunId}</p>
        </div>
        <div className="toolbar">
          <Link className="button" to="/workflow-runs">
            All WorkflowRuns
          </Link>
          <button
            type="button"
            className="button"
            onClick={() => void runQuery.refetch()}
            disabled={runQuery.isFetching}
          >
            Refresh
          </button>
        </div>
      </header>

      {runQuery.isLoading && runQuery.data === undefined ? (
        <LoadingBlock label="Loading workflow run…" />
      ) : null}
      {notFound ? (
        <EmptyState
          title="WorkflowRun not found."
          description="This run is not visible in the authenticated workspace."
        />
      ) : null}
      {runQuery.isError && !notFound ? (
        <ErrorState
          title="Failed to load workflow run"
          error={runQuery.error}
        />
      ) : null}

      {runQuery.data !== undefined ? (
        <>
          <section className="panel">
            <div className="page-header" style={{ marginBottom: 12 }}>
              <StatusChip
                status={runQuery.data.status}
                category={workflowRunStatusCategory(runQuery.data.status)}
              />
              {runQuery.isFetching ? (
                <span className="muted" style={{ fontSize: 12 }}>
                  Refreshing…
                </span>
              ) : null}
            </div>
            <dl className="meta-grid">
              <div>
                <dt>Workflow ID</dt>
                <dd>
                  <Link
                    className="mono"
                    to={`/workflows/${runQuery.data.workflowId}`}
                  >
                    {runQuery.data.workflowId}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>WorkflowVersion ID</dt>
                <dd>
                  <Link
                    className="mono"
                    to={`/workflows/${runQuery.data.workflowId}/versions/${runQuery.data.workflowVersionId}`}
                  >
                    {runQuery.data.workflowVersionId}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatTimestamp(runQuery.data.createdAt)}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{formatTimestamp(runQuery.data.startedAt)}</dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{formatTimestamp(runQuery.data.completedAt)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatTimestamp(runQuery.data.updatedAt)}</dd>
              </div>
            </dl>
            {runQuery.data.error !== undefined ? (
              <p className="error-inline">
                {runQuery.data.error.code}: {runQuery.data.error.message}
              </p>
            ) : null}
          </section>

          <section className="grid-two">
            <div className="panel">
              <h2 className="panel-title">Input</h2>
              <JsonView value={runQuery.data.input} />
            </div>
            <div className="panel">
              <h2 className="panel-title">Output</h2>
              {runQuery.data.output !== undefined ? (
                <JsonView value={runQuery.data.output} />
              ) : (
                <p className="muted">No output yet.</p>
              )}
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-title">Execution</h2>
            {versionQuery.isLoading ? (
              <LoadingBlock label="Loading workflow definition…" />
            ) : null}
            {versionQuery.isError ? (
              <ErrorState
                title="Failed to load workflow version"
                error={versionQuery.error}
              />
            ) : null}
            {definition !== undefined ? (
              <div className="stack">
                {orderedKeys.map((key, index) => {
                  const node = definition.nodes.find(
                    (entry) => entry.key === key,
                  );
                  if (node === undefined) {
                    return null;
                  }
                  const nodeRun = nodeRunByKey.get(node.key);
                  const approvalRequest =
                    nodeRun === undefined
                      ? undefined
                      : approvalByNodeRunId.get(nodeRun.id);
                  return (
                    <WorkflowNodeExecutionCard
                      key={node.key}
                      definition={definition}
                      node={node}
                      nodeRun={nodeRun}
                      approvalRequest={approvalRequest}
                      workflowRunId={workflowRunId}
                      workflowInput={runQuery.data.input}
                      canExecute={canExecute}
                      showConnector={index > 0}
                    />
                  );
                })}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </>
  );
}
