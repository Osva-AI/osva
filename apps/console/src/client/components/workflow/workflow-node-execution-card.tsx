import { Link } from "react-router-dom";

import type {
  ApprovalRequestResource,
  WorkflowNodeRunResource,
} from "../../hooks/use-workflow-runs";
import type {
  WorkflowDefinitionNode,
  WorkflowDefinitionView,
} from "../../lib/workflow-definition";
import {
  incomingNodeKeys,
  resolveJsonPointerValue,
} from "../../lib/workflow-definition";
import { formatTimestamp, formatDurationMs } from "../../lib/formatting";
import { workflowNodeRunStatusCategory } from "../../lib/statuses";
import { JsonView } from "../json-view/json-view";
import { StatusChip } from "../status/status-chip";
import { WorkflowApprovalActions } from "./workflow-approval-actions";
import { WorkflowEventEmitForm } from "./workflow-event-emit-form";

interface WorkflowNodeExecutionCardProps {
  readonly definition: WorkflowDefinitionView;
  readonly node: WorkflowDefinitionNode;
  readonly nodeRun: WorkflowNodeRunResource | undefined;
  readonly approvalRequest: ApprovalRequestResource | undefined;
  readonly workflowRunId: string;
  readonly workflowInput: unknown;
  readonly canExecute: boolean;
  readonly showConnector: boolean;
}

export function WorkflowNodeExecutionCard({
  definition,
  node,
  nodeRun,
  approvalRequest,
  workflowRunId,
  workflowInput,
  canExecute,
  showConnector,
}: WorkflowNodeExecutionCardProps) {
  const status = nodeRun?.status ?? "PENDING";
  const incoming = incomingNodeKeys(definition, node.key);

  return (
    <article className="execution-node">
      {showConnector ? <div className="execution-connector">↓</div> : null}
      <div className="execution-node-card panel">
        <header className="execution-node-header">
          <div>
            <div className="execution-node-title">
              <span className="mono">{node.key}</span>{" "}
              <span className="muted">({node.type})</span>
            </div>
            {incoming.length > 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>
                After: {incoming.join(", ")}
              </div>
            ) : null}
          </div>
          <StatusChip
            status={status}
            category={workflowNodeRunStatusCategory(status)}
          />
        </header>

        <dl className="meta-grid">
          {nodeRun?.sequence !== undefined ? (
            <>
              <dt>Sequence</dt>
              <dd>{nodeRun.sequence}</dd>
            </>
          ) : null}
          {nodeRun?.startedAt !== undefined ? (
            <>
              <dt>Started</dt>
              <dd>{formatTimestamp(nodeRun.startedAt)}</dd>
            </>
          ) : null}
          {nodeRun?.completedAt !== undefined ? (
            <>
              <dt>Completed</dt>
              <dd>{formatTimestamp(nodeRun.completedAt)}</dd>
            </>
          ) : null}
          {nodeRun?.startedAt !== undefined &&
          nodeRun.completedAt !== undefined ? (
            <>
              <dt>Duration</dt>
              <dd>
                {formatDurationMs(nodeRun.startedAt, nodeRun.completedAt)}
              </dd>
            </>
          ) : null}
          {nodeRun?.selectedTargetKey !== undefined ? (
            <>
              <dt>Branch target</dt>
              <dd className="mono">{nodeRun.selectedTargetKey}</dd>
            </>
          ) : null}
        </dl>

        {renderNodeDefinitionDetails(node, workflowInput)}

        {nodeRun?.error !== undefined ? (
          <p className="error-inline">
            {nodeRun.error.code}: {nodeRun.error.message}
          </p>
        ) : null}

        {node.type === "AGENT" && nodeRun?.childRunId !== undefined ? (
          <p>
            <Link className="mono" to={`/runs/${nodeRun.childRunId}`}>
              Open child Run {nodeRun.childRunId}
            </Link>
          </p>
        ) : null}

        {node.type === "APPROVAL" ? (
          <WorkflowApprovalActions
            node={node}
            approvalRequest={approvalRequest}
            workflowRunId={workflowRunId}
            canExecute={canExecute}
          />
        ) : null}

        {node.type === "WAIT" &&
        isEventWaitNode(node) &&
        nodeRun?.status === "WAITING" ? (
          <WorkflowEventEmitForm
            wait={node.wait as EventWaitConfig}
            workflowInput={workflowInput}
            workflowRunId={workflowRunId}
            canExecute={canExecute}
          />
        ) : null}

        {nodeRun?.input !== undefined ? (
          <details>
            <summary>Node input</summary>
            <JsonView value={nodeRun.input} />
          </details>
        ) : null}
        {nodeRun?.output !== undefined ? (
          <details>
            <summary>Node output</summary>
            <JsonView value={nodeRun.output} />
          </details>
        ) : null}
      </div>
    </article>
  );
}

interface EventWaitConfig {
  readonly kind: "EVENT";
  readonly source: string;
  readonly eventType: string;
  readonly correlation: {
    readonly kind: "LITERAL" | "INPUT_POINTER";
    readonly value?: string;
    readonly pointer?: string;
  };
  readonly timeoutMs?: number;
}

function isEventWaitNode(node: WorkflowDefinitionNode): boolean {
  if (node.type !== "WAIT" || node.wait === undefined) {
    return false;
  }
  const wait = node.wait as { kind?: string };
  return wait.kind === "EVENT";
}

function renderNodeDefinitionDetails(
  node: WorkflowDefinitionNode,
  workflowInput: unknown,
) {
  if (node.type === "AGENT" && typeof node.agentVersionId === "string") {
    return (
      <p className="muted">
        Agent version: <span className="mono">{node.agentVersionId}</span>
      </p>
    );
  }

  if (node.type === "APPROVAL") {
    return (
      <div>
        {typeof node.title === "string" ? (
          <p>
            <strong>{node.title}</strong>
          </p>
        ) : null}
        {typeof node.description === "string" ? (
          <p className="muted">{node.description}</p>
        ) : null}
      </div>
    );
  }

  if (node.type === "BRANCH") {
    return (
      <dl className="meta-grid">
        {typeof node.selector === "string" ? (
          <>
            <dt>Selector</dt>
            <dd className="mono">{node.selector}</dd>
          </>
        ) : null}
        {typeof node.defaultTo === "string" ? (
          <>
            <dt>Default</dt>
            <dd className="mono">{node.defaultTo}</dd>
          </>
        ) : null}
      </dl>
    );
  }

  if (node.type === "WAIT" && node.wait !== undefined) {
    const wait = node.wait as Record<string, unknown>;
    return (
      <dl className="meta-grid">
        <dt>Wait kind</dt>
        <dd className="mono">{String(wait.kind ?? "unknown")}</dd>
        {wait.kind === "DURATION" ? (
          <>
            <dt>Duration</dt>
            <dd>{String(wait.durationMs)} ms</dd>
          </>
        ) : null}
        {wait.kind === "UNTIL" && typeof wait.until === "string" ? (
          <>
            <dt>Until</dt>
            <dd>{formatTimestamp(wait.until)}</dd>
          </>
        ) : null}
        {wait.kind === "EVENT" ? (
          <>
            <dt>Source</dt>
            <dd className="mono">{String(wait.source ?? "")}</dd>
            <dt>Event type</dt>
            <dd className="mono">{String(wait.eventType ?? "")}</dd>
            <dt>Correlation</dt>
            <dd>{describeCorrelation(wait, workflowInput)}</dd>
            {wait.timeoutMs !== undefined ? (
              <>
                <dt>Timeout</dt>
                <dd>{String(wait.timeoutMs)} ms</dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>
    );
  }

  return null;
}

function describeCorrelation(
  wait: Record<string, unknown>,
  workflowInput: unknown,
): string {
  const correlation = wait.correlation as
    { kind?: string; value?: string; pointer?: string } | undefined;
  if (correlation === undefined) {
    return "—";
  }
  if (correlation.kind === "LITERAL") {
    return correlation.value ?? "—";
  }
  if (
    correlation.kind === "INPUT_POINTER" &&
    correlation.pointer !== undefined
  ) {
    const resolved = resolveJsonPointerValue(
      correlation.pointer,
      workflowInput,
    );
    if (typeof resolved === "string" && resolved.length > 0) {
      return `${correlation.pointer} → ${resolved}`;
    }
    return `${correlation.pointer} (resolve from workflow input)`;
  }
  return "—";
}
