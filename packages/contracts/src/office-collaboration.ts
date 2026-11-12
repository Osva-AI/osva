import type {
  ApprovalRequestId,
  ArtifactId,
  AssignmentId,
  GoalId,
  OfficeMessageId,
  OfficeThreadId,
  OfficeWorkerId,
  RunId,
  TeamId,
  UserId,
  WorkflowRunId,
  WorkspaceId,
} from "./ids.js";

export const OFFICE_THREAD_TYPES = ["WORKSPACE"] as const;
export type OfficeThreadType = (typeof OFFICE_THREAD_TYPES)[number];

export const OFFICE_MESSAGE_AUTHOR_TYPES = ["HUMAN"] as const;
export type OfficeMessageAuthorType =
  (typeof OFFICE_MESSAGE_AUTHOR_TYPES)[number];

export const OFFICE_MESSAGE_MENTION_KINDS = ["HUMAN", "OFFICE_WORKER"] as const;
export type OfficeMessageMentionKind =
  (typeof OFFICE_MESSAGE_MENTION_KINDS)[number];

export type OfficeMessageMentionV1 =
  | { readonly kind: "HUMAN"; readonly userId: UserId }
  | { readonly kind: "OFFICE_WORKER"; readonly officeWorkerId: OfficeWorkerId };

export const OFFICE_MESSAGE_REFERENCE_KINDS = [
  "ASSIGNMENT",
  "GOAL",
  "RUN",
  "WORKFLOW_RUN",
  "ARTIFACT",
  "APPROVAL_REQUEST",
] as const;
export type OfficeMessageReferenceKind =
  (typeof OFFICE_MESSAGE_REFERENCE_KINDS)[number];

export interface OfficeMessageReferenceV1 {
  readonly kind: OfficeMessageReferenceKind;
  readonly id: string;
}

export const INBOX_ITEM_KINDS = [
  "CHAT_MESSAGE",
  "CHAT_MENTION",
  "APPROVAL_PENDING",
  "ASSIGNMENT_UPDATE",
  "DELIVERABLE_READY",
] as const;
export type InboxItemKind = (typeof INBOX_ITEM_KINDS)[number];

export const INBOX_ASSIGNMENT_ATTENTION_STATES = [
  "FAILED",
  "CANCELLED",
] as const;
export type InboxAssignmentAttentionState =
  (typeof INBOX_ASSIGNMENT_ATTENTION_STATES)[number];

export interface OfficeThreadResourceV1 {
  readonly id: OfficeThreadId;
  readonly workspaceId: WorkspaceId;
  readonly title: string;
  readonly type: OfficeThreadType;
  readonly teamId?: TeamId;
  readonly goalId?: GoalId;
  readonly createdByUserId: UserId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly latestMessageSequence: number;
  readonly unreadCount?: number;
}

export interface OfficeThreadListResourceV1 {
  readonly items: readonly OfficeThreadResourceV1[];
  readonly nextCursor?: string;
}

export interface CreateOfficeThreadRequestV1 {
  readonly title: string;
  readonly type?: OfficeThreadType;
  readonly teamId?: TeamId;
  readonly goalId?: GoalId;
}

export interface OfficeMessageResourceV1 {
  readonly id: OfficeMessageId;
  readonly workspaceId: WorkspaceId;
  readonly threadId: OfficeThreadId;
  readonly sequence: number;
  readonly authorType: OfficeMessageAuthorType;
  readonly authorUserId?: UserId;
  readonly body: string;
  readonly parentMessageId?: OfficeMessageId;
  readonly mentions: readonly OfficeMessageMentionV1[];
  readonly references: readonly OfficeMessageReferenceV1[];
  readonly createdAt: string;
}

export interface OfficeMessageListResourceV1 {
  readonly items: readonly OfficeMessageResourceV1[];
  readonly nextCursor?: string;
}

export interface CreateOfficeMessageRequestV1 {
  readonly body: string;
  readonly parentMessageId?: OfficeMessageId;
  readonly mentions?: readonly OfficeMessageMentionV1[];
  readonly references?: readonly OfficeMessageReferenceV1[];
  readonly idempotencyKey?: string;
}

export interface InboxItemResourceV1 {
  readonly id: string;
  readonly kind: InboxItemKind;
  readonly occurredAt: string;
  readonly unread: boolean;
  readonly title: string;
  readonly summary?: string;
  readonly threadId?: OfficeThreadId;
  readonly messageId?: OfficeMessageId;
  readonly approvalRequestId?: ApprovalRequestId;
  readonly assignmentId?: AssignmentId;
  readonly runId?: RunId;
  readonly workflowRunId?: WorkflowRunId;
  readonly artifactId?: ArtifactId;
}

export interface InboxListResourceV1 {
  readonly items: readonly InboxItemResourceV1[];
  readonly nextCursor?: string;
}

export interface UpdateInboxThreadReadStateRequestV1 {
  readonly threadId: OfficeThreadId;
  readonly lastReadSequence: number;
}

export interface UpdateInboxItemReadStateRequestV1 {
  readonly itemId: string;
}

export type UpdateInboxReadStateRequestV1 =
  UpdateInboxThreadReadStateRequestV1 | UpdateInboxItemReadStateRequestV1;

export interface InboxReadStateResourceV1 {
  readonly threadId: OfficeThreadId;
  readonly lastReadSequence: number;
  readonly updatedAt: string;
}

export interface InboxItemReadStateResourceV1 {
  readonly itemId: string;
  readonly updatedAt: string;
}

export type InboxReadStateMutationResourceV1 =
  InboxReadStateResourceV1 | InboxItemReadStateResourceV1;

export const OFFICE_THREAD_TITLE_MAX_LENGTH = 200;
export const OFFICE_MESSAGE_BODY_MAX_LENGTH = 32_000;
export const OFFICE_MESSAGE_IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const OFFICE_COLLABORATION_DEFAULT_PAGE_SIZE = 50;
export const OFFICE_COLLABORATION_MAX_PAGE_SIZE = 100;
