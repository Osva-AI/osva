import { lazy, Suspense, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { RunArtifactsSection } from "../components/artifact/run-artifacts-section";
import { WorkflowNodeExecutionCard } from "../components/workflow/workflow-node-execution-card";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { JsonView } from "../components/json-view/json-view";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { useWorkflowRunArtifactsQuery } from "../hooks/use-workflow-run-artifacts";
import { useWorkflowVersionQuery } from "../hooks/use-workflows";
import {
  useWorkflowRunQuery,
  type ApprovalRequestResource,
  type WorkflowNodeRunResource,
} from "../hooks/use-workflow-runs";
import {
  orderWorkflowNodeKeys,
  type WorkflowDefinitionView,
} from "../lib/workflow-definition";
import { roleCanExecuteControlPlaneActions } from "../lib/permissions";
import { formatTimestamp } from "../lib/formatting";
import { isWorkflowRunLive, workflowRunStatusCategory } from "../lib/statuses";
import { ConsoleApiError } from "../lib/console-api";
import {
  describeWorkflowSuspension,
  edgeAppearanceById,
  executionStatusByNodeKey,
  nodeRunsForKey,
  selectLatestNodeRunByKey,
} from "../lib/workflow-node-run-overlay";
import { describeWorkflowRunGuidance } from "../lib/operator-diagnostics";
import { OperatorGuidancePanel } from "../components/operator/operator-guidance";

const WorkflowGraphViewLazy = lazy(async () => {
  const module = await import("../components/workflow/workflow-graph-view");
  return { default: module.WorkflowGraphView };
});

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

  const [selectedNodeKey, setSelectedNodeKey] = useState<string | undefined>();
  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);
  const artifactsQuery = useWorkflowRunArtifactsQuery({
    workflowRunId,
    definition: versionQuery.data?.definition,
    nodeRuns: runQuery.data?.nodeRuns,
    workflowOutput: runQuery.data?.output,
    live:
      runQuery.data !== undefined && isWorkflowRunLive(runQuery.data.status),
  });

  if (workflowRunId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing workflowRunId.")}
      />
    );
  }

  const definition = versionQuery.data?.definition;
  const nodeRuns = runQuery.data?.nodeRuns ?? [];
  const nodeRunByKey = selectLatestNodeRunByKey(nodeRuns);
  const overlayStatuses = executionStatusByNodeKey(nodeRuns);
  const overlayEdges =
    definition === undefined ? {} : edgeAppearanceById(definition, nodeRuns);
  const approvalByNodeRunId = new Map(
    (runQuery.data?.approvalRequests ?? []).map((request) => [
      request.workflowNodeRunId,
      request,
    ]),
  );

  const orderedKeys =
    definition === undefined ? [] : orderWorkflowNodeKeys(definition);
  const waitingReasons =
    definition === undefined || runQuery.data?.status !== "WAITING"
      ? []
      : orderedKeys.flatMap((key) => {
          const node = definition.nodes.find((entry) => entry.key === key);
          if (node === undefined) {
            return [];
          }
          const reason = describeWorkflowSuspension(
            node,
            nodeRunByKey.get(key),
          );
          return reason === undefined ? [] : [{ key, reason }];
        });

  const workflowGuidance =
    runQuery.data !== undefined
      ? describeWorkflowRunGuidance({
          status: runQuery.data.status,
          error: runQuery.data.error,
        })
      : undefined;

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
            onClick={() => {
              void runQuery.refetch();
              void artifactsQuery.refetch();
            }}
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
              <p className="error-inline" role="alert">
                {runQuery.data.error.code}: {runQuery.data.error.message}
              </p>
            ) : null}
            {workflowGuidance !== undefined ? (
              <OperatorGuidancePanel
                guidance={workflowGuidance}
                testId="workflow-run-guidance"
              />
            ) : null}
          </section>

          {waitingReasons.length > 0 ? (
            <section className="panel" aria-labelledby="workflow-wait-title">
              <h2 className="panel-title" id="workflow-wait-title">
                Waiting
              </h2>
              <p className="muted">
                Resumed status appears only after the control plane confirms it.
                Approval and event actions below do not invent a local resume.
              </p>
              <ul>
                {waitingReasons.map((entry) => (
                  <li key={entry.key}>
                    <button
                      type="button"
                      className="button"
                      onClick={() => setSelectedNodeKey(entry.key)}
                    >
                      Focus {entry.key}
                    </button>{" "}
                    {entry.reason}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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
              <>
                <WorkflowRunGraphPanel
                  definition={definition}
                  executionStatusByNodeKey={overlayStatuses}
                  edgeAppearanceById={overlayEdges}
                  selectedNodeKey={selectedNodeKey}
                  onNodeSelect={setSelectedNodeKey}
                />
                <WorkflowRunNodeInspector
                  definition={definition}
                  selectedNodeKey={selectedNodeKey}
                  nodeRuns={nodeRuns}
                  nodeRunByKey={nodeRunByKey}
                  approvalByNodeRunId={approvalByNodeRunId}
                  workflowRunId={workflowRunId}
                  workflowInput={runQuery.data.input}
                  canExecute={canExecute}
                />
                <h3 className="section-title">Node list</h3>
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
                        relatedNodeRuns={nodeRunsForKey(nodeRuns, node.key)}
                        nodeRuns={nodeRuns}
                        approvalRequest={approvalRequest}
                        workflowRunId={workflowRunId}
                        workflowInput={runQuery.data.input}
                        canExecute={canExecute}
                        showConnector={index > 0}
                      />
                    );
                  })}
                </div>
              </>
            ) : null}
          </section>

          <RunArtifactsSection
            artifacts={artifactsQuery.data?.items}
            associations={artifactsQuery.data?.associations}
            isLoading={versionQuery.isLoading || artifactsQuery.isLoading}
            isError={artifactsQuery.isError || versionQuery.isError}
            error={artifactsQuery.error ?? versionQuery.error}
            live={isWorkflowRunLive(runQuery.data.status)}
            truncated={artifactsQuery.data?.truncated}
            failures={artifactsQuery.data?.failures}
          />

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
        </>
      ) : null}
    </>
  );
}

function WorkflowRunGraphPanel({
  definition,
  executionStatusByNodeKey: statuses,
  edgeAppearanceById: edgeAppearances,
  selectedNodeKey,
  onNodeSelect,
}: {
  readonly definition: WorkflowDefinitionView;
  readonly executionStatusByNodeKey: Readonly<Record<string, string>>;
  readonly edgeAppearanceById: Readonly<
    Record<string, "selected" | "inactive" | "skipped">
  >;
  readonly selectedNodeKey: string | undefined;
  readonly onNodeSelect: (nodeKey: string | undefined) => void;
}) {
  if (definition.schemaVersion !== "3") {
    return (
      <p className="muted">
        Execution graph overlay is available for workflow definition schema
        version 3 only.
      </p>
    );
  }

  return (
    <Suspense fallback={<LoadingBlock label="Loading execution graph…" />}>
      <WorkflowGraphViewLazy
        definition={definition}
        executionStatusByNodeKey={statuses}
        edgeAppearanceById={edgeAppearances}
        selectedNodeKey={selectedNodeKey}
        onNodeSelect={onNodeSelect}
      />
    </Suspense>
  );
}

function WorkflowRunNodeInspector({
  definition,
  selectedNodeKey,
  nodeRuns,
  nodeRunByKey,
  approvalByNodeRunId,
  workflowRunId,
  workflowInput,
  canExecute,
}: {
  readonly definition: WorkflowDefinitionView;
  readonly selectedNodeKey: string | undefined;
  readonly nodeRuns: readonly WorkflowNodeRunResource[];
  readonly nodeRunByKey: ReadonlyMap<string, WorkflowNodeRunResource>;
  readonly approvalByNodeRunId: ReadonlyMap<string, ApprovalRequestResource>;
  readonly workflowRunId: string;
  readonly workflowInput: unknown;
  readonly canExecute: boolean;
}) {
  if (selectedNodeKey === undefined) {
    return (
      <p className="muted">
        Select a node on the graph to inspect its persisted execution record.
      </p>
    );
  }

  const node = definition.nodes.find((entry) => entry.key === selectedNodeKey);
  if (node === undefined) {
    return (
      <p className="muted">
        Selected node {selectedNodeKey} is not in this WorkflowVersion.
      </p>
    );
  }

  const nodeRun = nodeRunByKey.get(node.key);
  const approvalRequest =
    nodeRun === undefined ? undefined : approvalByNodeRunId.get(nodeRun.id);

  return (
    <div data-testid="workflow-run-node-inspector">
      <h3 className="section-title">Selected node</h3>
      <WorkflowNodeExecutionCard
        definition={definition}
        node={node}
        nodeRun={nodeRun}
        relatedNodeRuns={nodeRunsForKey(nodeRuns, node.key)}
        nodeRuns={nodeRuns}
        approvalRequest={approvalRequest}
        workflowRunId={workflowRunId}
        workflowInput={workflowInput}
        canExecute={canExecute}
        showConnector={false}
      />
    </div>
  );
}
