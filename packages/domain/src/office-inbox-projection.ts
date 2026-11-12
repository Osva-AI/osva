import type {
  ApprovalRequestId,
  ArtifactId,
  AssignmentId,
  AssignmentState,
  InboxItemKind,
  InboxItemResourceV1,
  OfficeMessageId,
  RunId,
} from "@osva-ai/contracts";
import {
  INBOX_ASSIGNMENT_ATTENTION_STATES,
  type InboxAssignmentAttentionState,
} from "@osva-ai/contracts";

import type { ApprovalRequest } from "./approval-request.js";
import type { Artifact } from "./artifact.js";
import type { Assignment } from "./assignment.js";
import type { OfficeMessage } from "./office-message.js";

export function isInboxAssignmentAttentionState(
  status: AssignmentState,
): status is InboxAssignmentAttentionState {
  return (INBOX_ASSIGNMENT_ATTENTION_STATES as readonly string[]).includes(
    status,
  );
}

export function inboxItemIdForChatMessage(messageId: OfficeMessageId): string {
  return `chat:${messageId}`;
}

export function inboxItemIdForApproval(
  approvalRequestId: ApprovalRequestId,
): string {
  return `approval:${approvalRequestId}`;
}

export function inboxItemIdForAssignmentUpdate(
  assignmentId: AssignmentId,
  status: InboxAssignmentAttentionState,
): string {
  return `assignment:${assignmentId}:${status}`;
}

export function inboxItemIdForDeliverable(artifactId: ArtifactId): string {
  return `deliverable:${artifactId}`;
}

export function buildChatInboxItem(props: {
  readonly message: OfficeMessage;
  readonly threadTitle: string;
  readonly mentioned: boolean;
}): InboxItemResourceV1 {
  return {
    id: inboxItemIdForChatMessage(props.message.id),
    kind: props.mentioned ? "CHAT_MENTION" : "CHAT_MESSAGE",
    occurredAt: props.message.createdAt.toISOString(),
    unread: true,
    title: props.threadTitle,
    summary: props.message.body.slice(0, 240),
    threadId: props.message.threadId,
    messageId: props.message.id,
  };
}

export function buildApprovalInboxItem(
  request: ApprovalRequest,
): InboxItemResourceV1 {
  return {
    id: inboxItemIdForApproval(request.id),
    kind: "APPROVAL_PENDING",
    occurredAt: request.createdAt.toISOString(),
    unread: true,
    title: "Approval required",
    summary: "A workflow is waiting for a human decision.",
    approvalRequestId: request.id,
    workflowRunId: request.workflowRunId,
  };
}

export function buildAssignmentInboxItem(
  assignment: Assignment,
): InboxItemResourceV1 | null {
  if (!isInboxAssignmentAttentionState(assignment.status)) {
    return null;
  }

  const occurredAt =
    assignment.status === "FAILED"
      ? (assignment.completedAt ?? assignment.startedAt ?? assignment.createdAt)
      : (assignment.cancelledAt ?? assignment.createdAt);

  const title =
    assignment.status === "FAILED"
      ? `Assignment failed: ${assignment.title}`
      : `Assignment cancelled: ${assignment.title}`;

  return {
    id: inboxItemIdForAssignmentUpdate(assignment.id, assignment.status),
    kind: "ASSIGNMENT_UPDATE",
    occurredAt: occurredAt.toISOString(),
    unread: true,
    title,
    summary: assignment.description?.slice(0, 240),
    assignmentId: assignment.id,
    runId: assignment.runId,
    workflowRunId: assignment.workflowRunId,
  };
}

export function buildDeliverableInboxItem(props: {
  readonly artifact: Artifact;
  readonly assignmentId: AssignmentId;
  readonly assignmentTitle: string;
  readonly runId?: RunId;
}): InboxItemResourceV1 {
  return {
    id: inboxItemIdForDeliverable(props.artifact.id),
    kind: "DELIVERABLE_READY",
    occurredAt: props.artifact.createdAt.toISOString(),
    unread: true,
    title: `Deliverable: ${props.assignmentTitle}`,
    summary: props.artifact.name,
    assignmentId: props.assignmentId,
    artifactId: props.artifact.id,
    runId: props.runId,
  };
}

export function sortInboxItemsDescending(
  items: readonly InboxItemResourceV1[],
): InboxItemResourceV1[] {
  return [...items].sort((left, right) => {
    const byTime = right.occurredAt.localeCompare(left.occurredAt);
    if (byTime !== 0) {
      return byTime;
    }
    return right.id.localeCompare(left.id);
  });
}

export function paginateInboxItems(props: {
  readonly items: readonly InboxItemResourceV1[];
  readonly limit: number;
  readonly cursor?: { readonly occurredAt: string; readonly id: string };
}): {
  readonly items: readonly InboxItemResourceV1[];
  readonly nextCursor?: { readonly occurredAt: string; readonly id: string };
} {
  let startIndex = 0;
  if (props.cursor !== undefined) {
    const index = props.items.findIndex(
      (item) =>
        item.occurredAt < props.cursor!.occurredAt ||
        (item.occurredAt === props.cursor!.occurredAt &&
          item.id < props.cursor!.id),
    );
    startIndex = index === -1 ? props.items.length : index;
  }

  const page = props.items.slice(startIndex, startIndex + props.limit);
  const hasMore = startIndex + props.limit < props.items.length;
  const next =
    hasMore && page.length > 0
      ? {
          occurredAt: page.at(-1)!.occurredAt,
          id: page.at(-1)!.id,
        }
      : undefined;

  return { items: page, nextCursor: next };
}

export function inboxItemKindIsOperational(kind: InboxItemKind): boolean {
  return (
    kind === "APPROVAL_PENDING" ||
    kind === "ASSIGNMENT_UPDATE" ||
    kind === "DELIVERABLE_READY"
  );
}

export type ParsedOperationalInboxItemId =
  | { readonly kind: "approval"; readonly approvalRequestId: ApprovalRequestId }
  | {
      readonly kind: "assignment";
      readonly assignmentId: AssignmentId;
      readonly status: InboxAssignmentAttentionState;
    }
  | { readonly kind: "deliverable"; readonly artifactId: ArtifactId };

export function parseOperationalInboxItemId(
  itemId: string,
): ParsedOperationalInboxItemId | null {
  const segments = itemId.split(":");
  if (segments.length < 2) {
    return null;
  }
  const prefix = segments[0];
  if (prefix === "approval" && segments.length === 2) {
    return {
      kind: "approval",
      approvalRequestId: segments[1] as ApprovalRequestId,
    };
  }
  if (prefix === "assignment" && segments.length === 3) {
    const status = segments[2] as AssignmentState;
    if (!isInboxAssignmentAttentionState(status)) {
      return null;
    }
    return {
      kind: "assignment",
      assignmentId: segments[1] as AssignmentId,
      status,
    };
  }
  if (prefix === "deliverable" && segments.length === 2) {
    return {
      kind: "deliverable",
      artifactId: segments[1] as ArtifactId,
    };
  }
  return null;
}
