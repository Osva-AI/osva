import { useState } from "react";
import { Link } from "react-router-dom";

import {
  useAcknowledgeInboxItemMutation,
  type InboxItemResource,
} from "../../hooks/use-office-collaboration";
import { useApprovalDecisionMutation } from "../../hooks/use-workflow-runs";
import { ConsoleApiError } from "../../lib/console-api";
import { formatTimestamp } from "../../lib/formatting";
import { Button } from "../ui/button";

interface OfficeInboxItemRowProps {
  readonly item: InboxItemResource;
  readonly canExecute: boolean;
}

export function OfficeInboxItemRow({
  item,
  canExecute,
}: OfficeInboxItemRowProps) {
  const acknowledge = useAcknowledgeInboxItemMutation();
  const approvalDecision = useApprovalDecisionMutation(
    item.workflowRunId ?? "",
  );
  const [comment, setComment] = useState("");
  const [feedback, setFeedback] = useState<string | undefined>();

  const sourceLink = resolveInboxItemLink(item);

  async function dismiss() {
    await acknowledge.mutateAsync({ itemId: item.id });
  }

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (item.approvalRequestId === undefined) {
      return;
    }
    setFeedback(undefined);
    try {
      await approvalDecision.mutateAsync({
        approvalRequestId: item.approvalRequestId,
        decision,
        comment: comment.trim().length > 0 ? comment.trim() : undefined,
      });
      setFeedback(
        decision === "APPROVED" ? "Approval recorded." : "Rejection recorded.",
      );
    } catch (error) {
      setFeedback(
        error instanceof ConsoleApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Decision failed.",
      );
    }
  }

  return (
    <li
      className={
        item.unread
          ? "office-inbox-item office-inbox-item--unread"
          : "office-inbox-item"
      }
    >
      <div className="office-inbox-item-header">
        <span className="office-inbox-kind">{formatInboxKind(item.kind)}</span>
        <time dateTime={item.occurredAt}>
          {formatTimestamp(item.occurredAt)}
        </time>
      </div>
      <strong>{item.title}</strong>
      {item.summary !== undefined ? <p>{item.summary}</p> : null}
      {sourceLink !== null ? (
        <Link to={sourceLink.to} className="text-link">
          {sourceLink.label}
        </Link>
      ) : null}
      {item.kind === "APPROVAL_PENDING" &&
      item.approvalRequestId !== undefined ? (
        <section className="stack" aria-label="Approval actions">
          {canExecute ? (
            <>
              <div className="field">
                <label htmlFor={`approval-comment-${item.id}`}>
                  Decision comment (optional)
                </label>
                <input
                  id={`approval-comment-${item.id}`}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  disabled={approvalDecision.isPending}
                />
              </div>
              <div className="toolbar">
                <Button
                  type="button"
                  variant="primary"
                  disabled={approvalDecision.isPending}
                  onClick={() => void decide("APPROVED")}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={approvalDecision.isPending}
                  onClick={() => void decide("REJECTED")}
                >
                  Reject
                </Button>
              </div>
            </>
          ) : (
            <p className="muted">
              Your workspace role can view this approval but cannot decide it
              (EXECUTE required).
            </p>
          )}
          {feedback !== undefined ? <p className="muted">{feedback}</p> : null}
        </section>
      ) : null}
      {item.kind !== "CHAT_MESSAGE" && item.kind !== "CHAT_MENTION" ? (
        <Button
          type="button"
          variant="secondary"
          disabled={acknowledge.isPending}
          onClick={() => void dismiss()}
        >
          Mark read
        </Button>
      ) : null}
      {item.threadId !== undefined ? (
        <Link to={`/office/chat/${item.threadId}`} className="text-link">
          Open conversation
        </Link>
      ) : null}
    </li>
  );
}

function formatInboxKind(kind: InboxItemResource["kind"]): string {
  switch (kind) {
    case "CHAT_MESSAGE":
      return "Message";
    case "CHAT_MENTION":
      return "Mention";
    case "APPROVAL_PENDING":
      return "Approval";
    case "ASSIGNMENT_UPDATE":
      return "Assignment";
    case "DELIVERABLE_READY":
      return "Deliverable";
    default:
      return kind;
  }
}

function resolveInboxItemLink(
  item: InboxItemResource,
): { readonly to: string; readonly label: string } | null {
  if (item.workflowRunId !== undefined && item.kind === "APPROVAL_PENDING") {
    return {
      to: `/workflow-runs/${encodeURIComponent(item.workflowRunId)}`,
      label: "Open workflow run",
    };
  }
  if (item.runId !== undefined) {
    return {
      to: `/runs/${encodeURIComponent(item.runId)}`,
      label: "Open run",
    };
  }
  if (item.assignmentId !== undefined) {
    return {
      to: "/office",
      label: "Open Mission Control",
    };
  }
  return null;
}
