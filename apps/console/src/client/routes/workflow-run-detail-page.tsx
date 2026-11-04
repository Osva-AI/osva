import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";

import { RunArtifactsSection } from "../components/artifact/run-artifacts-section";
import { WorkflowNodeExecutionCard } from "../components/workflow/workflow-node-execution-card";
import { WorkflowRunExecutionList } from "../components/workflow/workflow-run-execution-list";
import { WorkflowRunWaitingActionPanel } from "../components/workflow/workflow-run-waiting-action-panel";
import { useWorkflowCanvasLabelContext } from "../hooks/use-workflow-canvas-label-context";
import { resolveWorkflowCanvasLabel } from "../lib/workflow-canvas-labels";
import {
  findPrimaryWaitingNodeKey,
  inferDefaultSelectedNodeKey,
} from "../lib/workflow-run-detail-selection";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { JsonView } from "../components/json-view/json-view";
import { LoadingBlock } from "../components/loading/loading-block";
import { OperatorGuidancePanel } from "../components/operator/operator-guidance";
import { StatusChip } from "../components/status/status-chip";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { useWorkflowRunArtifactsQuery } from "../hooks/use-workflow-run-artifacts";
import { useWorkflowVersionQuery } from "../hooks/use-workflows";
import {
  useWorkflowRunQuery,
  type ApprovalRequestResource,
  type WorkflowNodeRunResource,
} from "../hooks/use-workflow-runs";
import { shortenResourceId } from "../lib/activity-feed";
import { formatActivityTimestamp, formatTimestamp } from "../lib/formatting";
import { roleCanExecuteControlPlaneActions } from "../lib/permissions";
import { ConsoleApiError } from "../lib/console-api";
import { describeWorkflowRunGuidance } from "../lib/operator-diagnostics";
import { isWorkflowRunLive, workflowRunStatusCategory } from "../lib/statuses";
import { workflowRunExecutionStatusLabel } from "../lib/workflow-execution-labels";
import {
  describeWorkflowSuspension,
  edgeAppearanceById,
  executionStatusByNodeKey,
  nodeRunsForKey,
  selectLatestNodeRunByKey,
} from "../lib/workflow-node-run-overlay";
import type { WorkflowDefinitionView } from "../lib/workflow-definition";

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
  const userSelectedRef = useRef(false);
  const canvasLabels = useWorkflowCanvasLabelContext();
  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);

  const run = runQuery.data;
  const definition = versionQuery.data?.definition;
  const nodeRuns = run?.nodeRuns ?? [];

  const nodeRunByKey = useMemo(
    () => selectLatestNodeRunByKey(nodeRuns),
    [nodeRuns],
  );

  const overlayStatuses = useMemo(
    () => executionStatusByNodeKey(nodeRuns),
    [nodeRuns],
  );

  const overlayEdges = useMemo(
    () =>
      definition === undefined ? {} : edgeAppearanceById(definition, nodeRuns),
    [definition, nodeRuns],
  );

  const approvalByNodeRunId = useMemo(
    () =>
      new Map(
        (run?.approvalRequests ?? []).map((request) => [
          request.workflowNodeRunId,
          request,
        ]),
      ),
    [run?.approvalRequests],
  );

  const waitingReasons = useMemo(() => {
    if (definition === undefined || run?.status !== "WAITING") {
      return [];
    }
    return definition.nodes.flatMap((node) => {
      const reason = describeWorkflowSuspension(
        node,
        nodeRunByKey.get(node.key),
      );
      return reason === undefined ? [] : [{ key: node.key, reason }];
    });
  }, [definition, nodeRunByKey, run?.status]);

  const workflowGuidance =
    run !== undefined
      ? describeWorkflowRunGuidance({
          status: run.status,
          error: run.error,
        })
      : undefined;

  const showFailureFirst = run?.status === "FAILED";

  const artifactsQuery = useWorkflowRunArtifactsQuery({
    workflowRunId,
    definition,
    nodeRuns,
    workflowOutput: run?.output,
    live: run !== undefined && isWorkflowRunLive(run.status),
  });

  const primaryWaitingNodeKey = useMemo(() => {
    if (definition === undefined || run?.status !== "WAITING") {
      return undefined;
    }
    return findPrimaryWaitingNodeKey({ definition, nodeRuns });
  }, [definition, nodeRuns, run?.status]);

  const selectNodeKey = useCallback(
    (nodeKey: string | undefined, user: boolean) => {
      if (user) {
        userSelectedRef.current = true;
      }
      setSelectedNodeKey(nodeKey);
    },
    [],
  );

  useEffect(() => {
    userSelectedRef.current = false;
    setSelectedNodeKey(undefined);
  }, [workflowRunId]);

  useEffect(() => {
    if (
      userSelectedRef.current ||
      definition === undefined ||
      run === undefined ||
      selectedNodeKey !== undefined
    ) {
      return;
    }
    const inferred = inferDefaultSelectedNodeKey({
      runStatus: run.status,
      definition,
      nodeRuns,
    });
    if (inferred !== undefined) {
      setSelectedNodeKey(inferred);
    }
  }, [definition, nodeRuns, run, selectedNodeKey]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        selectNodeKey(undefined, true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectNodeKey]);

  if (workflowRunId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing workflowRunId.")}
      />
    );
  }

  const runLive = run !== undefined && isWorkflowRunLive(run.status);
  const refreshing = runQuery.isFetching || versionQuery.isFetching;

  function refreshAll(): void {
    void runQuery.refetch();
    void versionQuery.refetch();
    void artifactsQuery.refetch();
  }

  return (
    <div
      className="workflow-run-detail-v2 page-stack"
      data-testid="workflow-run-detail-v2"
    >
      <header className="run-detail-outcome panel">
        <div className="run-detail-outcome-main">
          <div className="run-detail-outcome-headline">
            <h1 className="run-detail-title">Workflow run</h1>
            {run !== undefined ? (
              <StatusChip
                status={run.status}
                category={workflowRunStatusCategory(run.status)}
                label={workflowRunExecutionStatusLabel(run.status)}
              />
            ) : null}
            {runLive ? (
              <span className="run-detail-live muted" role="status">
                Live
              </span>
            ) : null}
          </div>
          {run !== undefined ? (
            <p className="muted run-detail-run-meta">
              <span className="mono" title={run.id}>
                {shortenResourceId(run.id)}
              </span>
              {" · "}
              Created {formatActivityTimestamp(run.createdAt)}
              {run.startedAt !== undefined ? (
                <>
                  {" · "}
                  Started {formatActivityTimestamp(run.startedAt)}
                </>
              ) : null}
              {run.completedAt !== undefined ? (
                <>
                  {" · "}
                  Completed {formatActivityTimestamp(run.completedAt)}
                </>
              ) : null}
            </p>
          ) : (
            <p className="page-subtitle mono">{workflowRunId}</p>
          )}
        </div>
        {run !== undefined &&
        definition !== undefined &&
        primaryWaitingNodeKey !== undefined
          ? (() => {
              const waitNode = definition.nodes.find(
                (entry) => entry.key === primaryWaitingNodeKey,
              );
              const waitRun = nodeRunByKey.get(primaryWaitingNodeKey);
              if (waitNode === undefined || waitRun === undefined) {
                return null;
              }
              return (
                <WorkflowRunWaitingActionPanel
                  node={waitNode}
                  nodeRun={waitRun}
                  approvalRequest={approvalByNodeRunId.get(waitRun.id)}
                  workflowRunId={workflowRunId}
                  workflowInput={run.input}
                  canExecute={canExecute}
                  canvasLabels={canvasLabels}
                />
              );
            })()
          : null}
        <div className="toolbar run-detail-toolbar">
          {refreshing ? (
            <span className="muted run-detail-refresh-hint" role="status">
              Refreshing…
            </span>
          ) : null}
          <Link className="button" to="/workflow-runs">
            All workflow runs
          </Link>
          <Link className="button" to="/activity">
            Activity
          </Link>
          <button
            type="button"
            className="button"
            onClick={refreshAll}
            disabled={runQuery.isFetching}
          >
            Refresh
          </button>
        </div>
        {showFailureFirst && workflowGuidance !== undefined ? (
          <OperatorGuidancePanel
            guidance={workflowGuidance}
            testId="workflow-run-guidance"
          />
        ) : null}
        {!showFailureFirst &&
        workflowGuidance !== undefined &&
        primaryWaitingNodeKey === undefined ? (
          <OperatorGuidancePanel
            guidance={workflowGuidance}
            testId="workflow-run-guidance"
          />
        ) : null}
      </header>

      {runQuery.isLoading && run === undefined ? (
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

      {run !== undefined ? (
        <>
          <section
            className="run-detail-context panel"
            aria-labelledby="workflow-run-context-title"
          >
            <h2 id="workflow-run-context-title" className="panel-title">
              Workflow context
            </h2>
            <dl className="meta-grid">
              <div>
                <dt>Workflow</dt>
                <dd>
                  <Link className="mono" to={`/workflows/${run.workflowId}`}>
                    {run.workflowId}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>Workflow version</dt>
                <dd>
                  <Link
                    className="mono"
                    to={`/workflows/${run.workflowId}/versions/${run.workflowVersionId}`}
                  >
                    {run.workflowVersionId}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatTimestamp(run.updatedAt)}</dd>
              </div>
            </dl>
          </section>

          {waitingReasons.length > 0 && primaryWaitingNodeKey === undefined ? (
            <section
              className="workflow-run-waiting panel"
              aria-labelledby="workflow-wait-title"
            >
              <h2 className="panel-title" id="workflow-wait-title">
                Waiting
              </h2>
              <p className="muted">
                Resumed status appears only after the control plane confirms it.
                Approval and event actions do not force-resume the workflow
                locally.
              </p>
              <ul className="workflow-run-waiting-list">
                {waitingReasons.map((entry) => (
                  <li key={entry.key}>
                    <button
                      type="button"
                      className="button"
                      onClick={() => selectNodeKey(entry.key, true)}
                    >
                      Inspect {entry.key}
                    </button>{" "}
                    {entry.reason}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section
            className="workflow-run-execution panel"
            aria-labelledby="workflow-execution-title"
          >
            <h2 className="panel-title" id="workflow-execution-title">
              Execution
            </h2>
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
              <div className="workflow-run-execution-body">
                <div className="workflow-run-graph-column">
                  <WorkflowRunGraphPanel
                    definition={definition}
                    executionStatusByNodeKey={overlayStatuses}
                    edgeAppearanceById={overlayEdges}
                    selectedNodeKey={selectedNodeKey}
                    onNodeSelect={(key) => selectNodeKey(key, true)}
                    canvasLabelContext={canvasLabels}
                  />
                </div>
                <aside
                  className="workflow-run-inspector-column"
                  aria-label="Selected node inspector"
                >
                  <WorkflowRunNodeInspector
                    definition={definition}
                    selectedNodeKey={selectedNodeKey}
                    nodeRuns={nodeRuns}
                    nodeRunByKey={nodeRunByKey}
                    approvalByNodeRunId={approvalByNodeRunId}
                    workflowRunId={workflowRunId}
                    workflowInput={run.input}
                    canExecute={canExecute}
                    canvasLabels={canvasLabels}
                    hideOperatorActions={
                      primaryWaitingNodeKey !== undefined &&
                      selectedNodeKey === primaryWaitingNodeKey
                    }
                    onClose={() => selectNodeKey(undefined, true)}
                  />
                </aside>
                <WorkflowRunExecutionList
                  definition={definition}
                  nodeRuns={nodeRuns}
                  selectedNodeKey={selectedNodeKey}
                  canvasLabels={canvasLabels}
                  onSelectNodeKey={(key) => selectNodeKey(key, true)}
                />
              </div>
            ) : null}
            {definition === undefined &&
            !versionQuery.isLoading &&
            !versionQuery.isError ? (
              <EmptyState title="Workflow definition unavailable." />
            ) : null}
          </section>

          <section
            className="workflow-run-results panel"
            aria-labelledby="workflow-run-results-title"
          >
            <h2 className="panel-title" id="workflow-run-results-title">
              Results
            </h2>
            <h3 className="section-title" id="workflow-run-input-title">
              Input
            </h3>
            <JsonView value={run.input} />
            <h3 className="section-title">Output</h3>
            {run.output !== undefined ? (
              <JsonView value={run.output} />
            ) : (
              <EmptyState
                title={
                  runLive
                    ? "Output is not ready yet."
                    : "No workflow output recorded."
                }
                description={
                  runLive
                    ? "Terminal workflows publish output when orchestration completes."
                    : undefined
                }
              />
            )}
            <RunArtifactsSection
              artifacts={artifactsQuery.data?.items}
              associations={artifactsQuery.data?.associations}
              isLoading={versionQuery.isLoading || artifactsQuery.isLoading}
              isError={artifactsQuery.isError || versionQuery.isError}
              error={artifactsQuery.error ?? versionQuery.error}
              live={isWorkflowRunLive(run.status)}
              truncated={artifactsQuery.data?.truncated}
              failures={artifactsQuery.data?.failures}
            />
          </section>

          <details className="run-detail-advanced panel">
            <summary className="run-detail-advanced-summary">
              Advanced technical details
            </summary>
            <div className="run-detail-advanced-body">
              <h3 className="section-title">WorkflowRun</h3>
              <dl className="meta-grid">
                <div>
                  <dt>WorkflowRun ID</dt>
                  <dd className="mono">{run.id}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{run.status}</dd>
                </div>
              </dl>
              {run.error !== undefined ? (
                <JsonView label="Workflow error" value={run.error} />
              ) : null}
              <h3 className="section-title">WorkflowNodeRuns</h3>
              {nodeRuns.length === 0 ? (
                <p className="muted">No WorkflowNodeRun records persisted.</p>
              ) : (
                <ul className="workflow-run-node-run-ids">
                  {nodeRuns.map((nodeRun) => (
                    <li key={nodeRun.id} className="mono">
                      {nodeRun.id} · {nodeRun.workflowNodeKey} · seq{" "}
                      {nodeRun.sequence} · {nodeRun.status}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}

function WorkflowRunGraphPanel({
  definition,
  executionStatusByNodeKey: statuses,
  edgeAppearanceById: edgeAppearances,
  selectedNodeKey,
  onNodeSelect,
  canvasLabelContext,
}: {
  readonly definition: WorkflowDefinitionView;
  readonly executionStatusByNodeKey: Readonly<Record<string, string>>;
  readonly edgeAppearanceById: Readonly<
    Record<string, "selected" | "inactive" | "skipped">
  >;
  readonly selectedNodeKey: string | undefined;
  readonly onNodeSelect: (nodeKey: string | undefined) => void;
  readonly canvasLabelContext?: import("../lib/workflow-canvas-labels").WorkflowCanvasLabelContext;
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
        canvasLabelContext={canvasLabelContext}
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
  canvasLabels,
  hideOperatorActions,
  onClose,
}: {
  readonly definition: WorkflowDefinitionView;
  readonly selectedNodeKey: string | undefined;
  readonly nodeRuns: readonly WorkflowNodeRunResource[];
  readonly nodeRunByKey: ReadonlyMap<string, WorkflowNodeRunResource>;
  readonly approvalByNodeRunId: ReadonlyMap<string, ApprovalRequestResource>;
  readonly workflowRunId: string;
  readonly workflowInput: unknown;
  readonly canExecute: boolean;
  readonly canvasLabels: import("../lib/workflow-canvas-labels").WorkflowCanvasLabelContext;
  readonly hideOperatorActions: boolean;
  readonly onClose: () => void;
}) {
  if (selectedNodeKey === undefined) {
    return (
      <p className="muted workflow-run-inspector-empty">
        Select a node on the graph or execution list to inspect persisted
        WorkflowNodeRun records.
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
    <div
      className="workflow-run-inspector-panel"
      data-testid="workflow-run-node-inspector"
    >
      <div className="workflow-run-inspector-head">
        <h3 className="section-title">Selected node</h3>
        <button
          type="button"
          className="button workflow-run-inspector-close"
          onClick={onClose}
        >
          Clear selection
        </button>
      </div>
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
        hideOperatorActions={hideOperatorActions}
        displayTitle={resolveWorkflowCanvasLabel(node as never, canvasLabels)}
      />
    </div>
  );
}
