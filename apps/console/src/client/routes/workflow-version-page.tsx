import { lazy, Suspense } from "react";
import { Link, useParams } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { JsonView } from "../components/json-view/json-view";
import { LoadingBlock } from "../components/loading/loading-block";
import { WorkflowRunLaunchForm } from "../components/workflow/workflow-run-launch-form";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useWorkflowQuery,
  useWorkflowVersionQuery,
} from "../hooks/use-workflows";
import { orderWorkflowNodeKeys } from "../lib/workflow-definition";
import { formatTimestamp } from "../lib/formatting";
import { ConsoleApiError } from "../lib/console-api";
import { roleCanExecuteControlPlaneActions } from "../lib/permissions";
import type { WorkflowDefinitionView } from "../lib/workflow-definition";

const WorkflowGraphViewLazy = lazy(async () => {
  const module = await import("../components/workflow/workflow-graph-view");
  return { default: module.WorkflowGraphView };
});

export function WorkflowVersionPage() {
  const { workflowId, workflowVersionId } = useParams<{
    workflowId: string;
    workflowVersionId: string;
  }>();

  const versionQuery = useWorkflowVersionQuery(workflowId, workflowVersionId);
  const workflowQuery = useWorkflowQuery(workflowId);
  const authQuery = useAuthContextQuery();
  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);

  const notFound =
    versionQuery.isError &&
    versionQuery.error instanceof ConsoleApiError &&
    versionQuery.error.status === 404;

  if (workflowId === undefined || workflowVersionId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing route parameters.")}
      />
    );
  }

  const definition = versionQuery.data?.definition;
  const orderedKeys =
    definition === undefined
      ? []
      : orderWorkflowNodeKeys(definition).map((key) =>
          definition.nodes.find((node) => node.key === key),
        );

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Workflow version</h1>
          <p className="page-subtitle mono">{workflowVersionId}</p>
        </div>
        <Link className="button" to={`/workflows/${workflowId}`}>
          Back to workflow
        </Link>
      </header>

      {versionQuery.isLoading ? (
        <LoadingBlock label="Loading workflow version…" />
      ) : null}
      {notFound ? (
        <EmptyState
          title="Workflow version not found."
          description="This version is not visible for the workflow in your workspace."
        />
      ) : null}
      {versionQuery.isError && !notFound ? (
        <ErrorState
          title="Failed to load workflow version"
          error={versionQuery.error}
        />
      ) : null}

      {versionQuery.data !== undefined ? (
        <>
          <section className="panel">
            <dl className="meta-grid">
              <div>
                <dt>Workflow ID</dt>
                <dd className="mono">{versionQuery.data.workflowId}</dd>
              </div>
              <div>
                <dt>Version number</dt>
                <dd>{versionQuery.data.version}</dd>
              </div>
              <div>
                <dt>Schema</dt>
                <dd className="mono">
                  {versionQuery.data.definition.schemaVersion}
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatTimestamp(versionQuery.data.createdAt)}</dd>
              </div>
            </dl>
          </section>

          <WorkflowRunLaunchForm
            workflowId={versionQuery.data.workflowId}
            workflowKey={workflowQuery.data?.key}
            workflowName={workflowQuery.data?.name}
            workflowVersionId={versionQuery.data.id}
            versionNumber={versionQuery.data.version}
            canExecute={canExecute}
            definition={versionQuery.data.definition}
          />

          <section
            className="panel"
            aria-labelledby="workflow-version-graph-title"
          >
            <h2 className="panel-title" id="workflow-version-graph-title">
              Definition (graph)
            </h2>
            <p className="muted workflow-graph-intro">
              Read-only visualization. For screen readers and text search, use
              the structured list and JSON sections below.
            </p>
            <WorkflowVersionGraphPanel
              definition={versionQuery.data.definition}
            />
          </section>

          <section className="panel">
            <h2 className="panel-title">Definition (structured)</h2>
            <div className="stack">
              {orderedKeys.map((node, index) =>
                node === undefined ? null : (
                  <article key={node.key} className="attempt-card">
                    {index > 0 ? (
                      <div className="execution-connector">↓</div>
                    ) : null}
                    <div className="mono">
                      {node.key} · {node.type}
                    </div>
                    <NodeDefinitionSummary node={node} />
                  </article>
                ),
              )}
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-title">Definition (JSON)</h2>
            <JsonView value={versionQuery.data.definition} />
          </section>
        </>
      ) : null}
    </>
  );
}

function WorkflowVersionGraphPanel({
  definition,
}: {
  readonly definition: WorkflowDefinitionView;
}) {
  if (definition.schemaVersion !== "3") {
    return (
      <p className="muted">
        Graph view is available for workflow definition schema version 3 only.
      </p>
    );
  }

  return (
    <Suspense fallback={<LoadingBlock label="Loading graph view…" />}>
      <WorkflowGraphViewLazy definition={definition} />
    </Suspense>
  );
}

function NodeDefinitionSummary({
  node,
}: {
  readonly node: {
    readonly key: string;
    readonly type: string;
    readonly [key: string]: unknown;
  };
}) {
  if (node.type === "AGENT" && typeof node.agentVersionId === "string") {
    return (
      <p className="muted">
        agentVersionId: <span className="mono">{node.agentVersionId}</span>
      </p>
    );
  }
  if (node.type === "APPROVAL") {
    return (
      <p className="muted">
        {typeof node.title === "string" ? node.title : "Approval node"}
      </p>
    );
  }
  if (node.type === "WAIT" && node.wait !== undefined) {
    return (
      <p className="muted">
        wait: <span className="mono">{JSON.stringify(node.wait)}</span>
      </p>
    );
  }
  if (node.type === "BRANCH") {
    return (
      <p className="muted">
        selector {String(node.selector)} · default {String(node.defaultTo)}
      </p>
    );
  }
  return null;
}
