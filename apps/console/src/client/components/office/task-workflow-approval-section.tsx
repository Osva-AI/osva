import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { OfficeWorkflowApprovalView } from "@osva/domain/office-execution-context";

import type {
  ApprovalRequestResource,
  WorkflowRunResource,
} from "../../hooks/use-workflow-runs";
import type { WorkflowDefinitionView } from "../../lib/workflow-definition";
import { buildOfficeWorkflowApprovalViews } from "../../lib/office-execution-context";
import { formatTimestamp } from "../../lib/formatting";
import {
  describeWorkflowNodeExecutionStatus,
  workflowRunExecutionStatusLabel,
} from "../../lib/workflow-execution-labels";
import { WorkflowApprovalActions } from "../workflow/workflow-approval-actions";
import { StatusChip } from "../status/status-chip";
import {
  workflowNodeRunStatusCategory,
  workflowRunStatusCategory,
} from "../../lib/statuses";
import { SectionPanel } from "../ui/section-panel";

interface TaskWorkflowApprovalSectionProps {
  readonly assignmentId: string;
  readonly workspaceId: string;
  readonly workflowRun: WorkflowRunResource;
  readonly definition: WorkflowDefinitionView | undefined;
  readonly canExecute: boolean;
}

export function TaskWorkflowApprovalSection({
  assignmentId,
  workspaceId,
  workflowRun,
  definition,
  canExecute,
}: TaskWorkflowApprovalSectionProps) {
  const approvalViews = useMemo(() => {
    if (definition === undefined) {
      return [];
    }
    return buildOfficeWorkflowApprovalViews({
      workspaceId,
      workflowRun,
      workflowDefinition: definition,
    });
  }, [definition, workflowRun, workspaceId]);

  const nodeDefByKey = useMemo(() => {
    const map = new Map<string, WorkflowDefinitionView["nodes"][number]>();
    if (definition === undefined) {
      return map;
    }
    for (const node of definition.nodes) {
      map.set(node.key, node);
    }
    return map;
  }, [definition]);

  if (approvalViews.length === 0) {
    return null;
  }

  return (
    <SectionPanel title="Human approvals">
      <p className="muted">
        Approval status reflects the human decision on each{" "}
        <span className="mono">ApprovalRequest</span>. WorkflowRun status is{" "}
        <StatusChip
          status={workflowRunExecutionStatusLabel(workflowRun.status)}
          category={workflowRunStatusCategory(workflowRun.status)}
          label={workflowRun.status}
        />
        . Assignment lifecycle updates only when persisted execution data
        confirms completion — not immediately after you submit a decision.
      </p>
      <p>
        <Link
          to={`/workflow-runs/${workflowRun.id}`}
          data-testid="task-approval-workflow-run-link"
        >
          Open WorkflowRun detail
        </Link>
      </p>
      <ul className="stack" data-testid="task-workflow-approval-list">
        {approvalViews.map((view) => (
          <TaskWorkflowApprovalCard
            key={view.approvalRequestId}
            view={view}
            assignmentId={assignmentId}
            workflowRunId={workflowRun.id}
            node={nodeDefByKey.get(view.workflowNodeKey)}
            approvalRequest={workflowRun.approvalRequests.find(
              (row) => row.id === view.approvalRequestId,
            )}
            canExecute={canExecute}
          />
        ))}
      </ul>
    </SectionPanel>
  );
}

function TaskWorkflowApprovalCard(props: {
  readonly view: OfficeWorkflowApprovalView;
  readonly assignmentId: string;
  readonly workflowRunId: string;
  readonly node: WorkflowDefinitionView["nodes"][number] | undefined;
  readonly approvalRequest: ApprovalRequestResource | undefined;
  readonly canExecute: boolean;
}) {
  const waitingCopy =
    props.view.workflowNodeRunStatus === "WAITING" &&
    props.view.approvalStatus === "PENDING"
      ? "Workflow node is waiting for a human decision."
      : props.view.approvalStatus === "APPROVED"
        ? "Human approval recorded. Workflow progression depends on orchestration — refresh execution context to observe the next persisted node state."
        : props.view.approvalStatus === "REJECTED"
          ? "Human rejection recorded. Downstream steps run only if execution evidence exists."
          : undefined;

  return (
    <li
      className="panel"
      id={`task-approval-${props.view.approvalRequestId}`}
      data-testid={`task-approval-${props.view.approvalRequestId}`}
    >
      <div className="office-task-approval-card-head">
        <h3 className="section-title">
          {props.view.title ?? props.view.workflowNodeKey}
        </h3>
        <StatusChip
          status={props.view.approvalStatus}
          category={workflowNodeRunStatusCategory(props.view.approvalStatus)}
          label={`Approval: ${props.view.approvalStatus}`}
        />
      </div>
      {props.view.description !== undefined ? (
        <p className="muted">{props.view.description}</p>
      ) : null}
      <dl className="meta-grid compact">
        <div>
          <dt className="metric-label">Workflow node</dt>
          <dd className="mono">
            {props.view.workflowNodeKey} · Node run{" "}
            {describeWorkflowNodeExecutionStatus(
              props.view.workflowNodeRunStatus,
            )}{" "}
            ({props.view.workflowNodeRunStatus})
          </dd>
        </div>
        <div>
          <dt className="metric-label">Requested</dt>
          <dd>{formatTimestamp(props.view.approvalCreatedAt)}</dd>
        </div>
        {props.view.approvalDecidedAt !== undefined ? (
          <div>
            <dt className="metric-label">Decided</dt>
            <dd>{formatTimestamp(props.view.approvalDecidedAt)}</dd>
          </div>
        ) : null}
        {props.view.approvalDecisionComment !== undefined ? (
          <div>
            <dt className="metric-label">Decision comment</dt>
            <dd>{props.view.approvalDecisionComment}</dd>
          </div>
        ) : null}
      </dl>
      {waitingCopy !== undefined ? (
        <p className="muted" role="status">
          {waitingCopy}
        </p>
      ) : null}
      {props.node?.type === "APPROVAL" ? (
        <WorkflowApprovalActions
          node={props.node}
          approvalRequest={props.approvalRequest}
          workflowRunId={props.workflowRunId}
          canExecute={props.canExecute}
          workflowNodeRunStatus={props.view.workflowNodeRunStatus}
          assignmentId={props.assignmentId}
        />
      ) : (
        <p className="muted">Approval node definition is unavailable.</p>
      )}
    </li>
  );
}
