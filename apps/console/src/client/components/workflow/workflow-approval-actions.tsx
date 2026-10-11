import { useState } from "react";

import {
  useApprovalDecisionMutation,
  type ApprovalRequestResource,
} from "../../hooks/use-workflow-runs";
import type { WorkflowDefinitionNode } from "../../lib/workflow-definition";
import { ConsoleApiError } from "../../lib/console-api";
import { formatTimestamp } from "../../lib/formatting";

interface WorkflowApprovalActionsProps {
  readonly node: WorkflowDefinitionNode;
  readonly approvalRequest: ApprovalRequestResource | undefined;
  readonly workflowRunId: string;
  readonly canExecute: boolean;
}

export function WorkflowApprovalActions({
  node,
  approvalRequest,
  workflowRunId,
  canExecute,
}: WorkflowApprovalActionsProps) {
  const mutation = useApprovalDecisionMutation(workflowRunId);
  const [comment, setComment] = useState("");
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();

  if (approvalRequest === undefined) {
    return (
      <p className="muted">No ApprovalRequest record for this node yet.</p>
    );
  }

  async function submit(decision: "APPROVED" | "REJECTED") {
    setFeedback(undefined);
    setErrorRequestId(undefined);
    try {
      await mutation.mutateAsync({
        approvalRequestId: approvalRequest!.id,
        decision,
        comment: comment.trim().length > 0 ? comment.trim() : undefined,
      });
      setFeedback(
        decision === "APPROVED" ? "Approval recorded." : "Rejection recorded.",
      );
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Decision request failed.",
      );
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
      }
    }
  }

  return (
    <section className="operator-actions">
      <h3 className="section-title">Approval</h3>
      {typeof node.title === "string" ? (
        <p>
          <strong>{node.title}</strong>
        </p>
      ) : null}
      {typeof node.description === "string" ? (
        <p className="muted">{node.description}</p>
      ) : null}
      <dl className="meta-grid">
        <dt>Request ID</dt>
        <dd className="mono">{approvalRequest.id}</dd>
        <dt>Status</dt>
        <dd className="mono">{approvalRequest.status}</dd>
        {approvalRequest.decisionComment !== undefined ? (
          <>
            <dt>Comment</dt>
            <dd>{approvalRequest.decisionComment}</dd>
          </>
        ) : null}
        {approvalRequest.decidedAt !== undefined ? (
          <>
            <dt>Decided</dt>
            <dd>{formatTimestamp(approvalRequest.decidedAt)}</dd>
          </>
        ) : null}
      </dl>

      {approvalRequest.status === "PENDING" && canExecute ? (
        <div className="stack">
          <div className="field">
            <label htmlFor={`approval-comment-${approvalRequest.id}`}>
              Decision comment (optional)
            </label>
            <input
              id={`approval-comment-${approvalRequest.id}`}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              disabled={mutation.isPending}
            />
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="button primary"
              disabled={mutation.isPending}
              onClick={() => void submit("APPROVED")}
            >
              Approve
            </button>
            <button
              type="button"
              className="button danger"
              disabled={mutation.isPending}
              onClick={() => void submit("REJECTED")}
            >
              Reject
            </button>
          </div>
        </div>
      ) : null}

      {approvalRequest.status === "PENDING" && !canExecute ? (
        <p className="muted">
          Your API key role cannot submit approval decisions (EXECUTE required).
        </p>
      ) : null}

      {approvalRequest.status !== "PENDING" ? (
        <p className="muted">
          This approval is already {approvalRequest.status}.
        </p>
      ) : null}

      {feedback !== undefined ? <p>{feedback}</p> : null}
      {errorRequestId !== undefined ? (
        <p className="mono">Request ID: {errorRequestId}</p>
      ) : null}
    </section>
  );
}
