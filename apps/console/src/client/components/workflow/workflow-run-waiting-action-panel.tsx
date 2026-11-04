import type { WorkflowDefinitionNodeV3 } from "@osva-ai/contracts";

import type {
  ApprovalRequestResource,
  WorkflowNodeRunResource,
} from "../../hooks/use-workflow-runs";
import type { WorkflowDefinitionNode } from "../../lib/workflow-definition";
import {
  resolveWorkflowCanvasLabel,
  type WorkflowCanvasLabelContext,
} from "../../lib/workflow-canvas-labels";
import { describeWorkflowNodeWaitingDetail } from "../../lib/workflow-execution-labels";
import { describeWorkflowWaitReason } from "../../lib/workflow-node-run-overlay";
import { WorkflowApprovalActions } from "./workflow-approval-actions";
import { WorkflowEventEmitForm } from "./workflow-event-emit-form";

interface WorkflowRunWaitingActionPanelProps {
  readonly node: WorkflowDefinitionNode;
  readonly nodeRun: WorkflowNodeRunResource;
  readonly approvalRequest: ApprovalRequestResource | undefined;
  readonly workflowRunId: string;
  readonly workflowInput: unknown;
  readonly canExecute: boolean;
  readonly canvasLabels?: WorkflowCanvasLabelContext;
}

export function WorkflowRunWaitingActionPanel({
  node,
  nodeRun,
  approvalRequest,
  workflowRunId,
  workflowInput,
  canExecute,
  canvasLabels,
}: WorkflowRunWaitingActionPanelProps) {
  const title = resolveWorkflowCanvasLabel(
    node as WorkflowDefinitionNodeV3,
    canvasLabels,
  );
  const waitReason =
    describeWorkflowWaitReason(node, nodeRun) ??
    describeWorkflowNodeWaitingDetail({
      nodeType: node.type,
      waitKind:
        node.type === "WAIT" &&
        typeof node.wait === "object" &&
        node.wait !== null &&
        "kind" in node.wait
          ? String((node.wait as { kind?: string }).kind)
          : undefined,
    });

  const panelTitle =
    canExecute && (node.type === "APPROVAL" || node.type === "WAIT")
      ? "Action required"
      : node.type === "APPROVAL"
        ? "Waiting for approval"
        : "Waiting";

  return (
    <section
      className="workflow-run-waiting-action panel"
      data-testid="workflow-run-waiting-action"
      aria-labelledby="workflow-run-waiting-action-title"
    >
      <h2 className="panel-title" id="workflow-run-waiting-action-title">
        {panelTitle}
      </h2>
      <p className="workflow-run-waiting-action-lead">
        <strong>{title}</strong>
        <span className="muted workflow-run-waiting-action-reason">
          {" "}
          — {waitReason}
        </span>
      </p>
      <p className="muted workflow-run-waiting-action-hint">
        Submitting an approval or event does not force-resume the workflow.
        Refresh after the control plane confirms the next persisted state.
      </p>
      {node.type === "APPROVAL" && canExecute ? (
        <WorkflowApprovalActions
          node={node}
          approvalRequest={approvalRequest}
          workflowRunId={workflowRunId}
          canExecute={canExecute}
          workflowNodeRunStatus={nodeRun.status}
        />
      ) : null}
      {node.type === "WAIT" &&
      canExecute &&
      typeof node.wait === "object" &&
      node.wait !== null &&
      "kind" in node.wait &&
      (node.wait as { kind: string }).kind === "EVENT" ? (
        <WorkflowEventEmitForm
          wait={node.wait as never}
          workflowInput={workflowInput}
          workflowRunId={workflowRunId}
          canExecute={canExecute}
          compact
        />
      ) : null}
      {node.type === "WAIT" &&
      typeof node.wait === "object" &&
      node.wait !== null &&
      "kind" in node.wait &&
      (node.wait as { kind: string }).kind !== "EVENT" ? (
        <p className="muted">
          Open the node inspector below for timer or schedule wait details on{" "}
          <span className="mono">{node.key}</span>.
        </p>
      ) : null}
      {!canExecute ? (
        <p className="muted" role="status">
          Your role cannot submit approval decisions or workflow events. An
          operator with execute permission must act on this wait.
        </p>
      ) : null}
    </section>
  );
}
