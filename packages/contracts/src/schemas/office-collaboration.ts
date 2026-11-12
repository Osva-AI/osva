import { z } from "zod";

import {
  OFFICE_COLLABORATION_DEFAULT_PAGE_SIZE,
  OFFICE_COLLABORATION_MAX_PAGE_SIZE,
  OFFICE_MESSAGE_BODY_MAX_LENGTH,
  OFFICE_MESSAGE_IDEMPOTENCY_KEY_MAX_LENGTH,
  OFFICE_MESSAGE_MENTION_KINDS,
  OFFICE_MESSAGE_REFERENCE_KINDS,
  OFFICE_THREAD_TITLE_MAX_LENGTH,
  OFFICE_THREAD_TYPES,
  INBOX_ITEM_KINDS,
  OFFICE_MESSAGE_AUTHOR_TYPES,
} from "../office-collaboration.js";
import {
  approvalRequestIdSchema,
  artifactIdSchema,
  assignmentIdSchema,
  goalIdSchema,
  officeMessageIdSchema,
  officeThreadIdSchema,
  officeWorkerIdSchema,
  runIdSchema,
  teamIdSchema,
  userIdSchema,
  workflowRunIdSchema,
  workspaceIdSchema,
} from "./ids.js";

export const officeThreadTypeSchema = z.enum(OFFICE_THREAD_TYPES);
export const officeMessageAuthorTypeSchema = z.enum(
  OFFICE_MESSAGE_AUTHOR_TYPES,
);
export const inboxItemKindSchema = z.enum(INBOX_ITEM_KINDS);

export const officeMessageMentionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal(OFFICE_MESSAGE_MENTION_KINDS[0]),
    userId: userIdSchema,
  }),
  z.strictObject({
    kind: z.literal(OFFICE_MESSAGE_MENTION_KINDS[1]),
    officeWorkerId: officeWorkerIdSchema,
  }),
]);

export const officeMessageReferenceSchema = z.strictObject({
  kind: z.enum(OFFICE_MESSAGE_REFERENCE_KINDS),
  id: z.string().min(1),
});

export const createOfficeThreadRequestSchema = z.strictObject({
  title: z.string().min(1).max(OFFICE_THREAD_TITLE_MAX_LENGTH),
  type: officeThreadTypeSchema.optional(),
  teamId: teamIdSchema.optional(),
  goalId: goalIdSchema.optional(),
});

export const officeThreadResourceSchema = z.strictObject({
  id: officeThreadIdSchema,
  workspaceId: workspaceIdSchema,
  title: z.string().min(1),
  type: officeThreadTypeSchema,
  teamId: teamIdSchema.optional(),
  goalId: goalIdSchema.optional(),
  createdByUserId: userIdSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  latestMessageSequence: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative().optional(),
});

export const officeThreadListResourceSchema = z.strictObject({
  items: z.array(officeThreadResourceSchema),
  nextCursor: z.string().min(1).optional(),
});

export const listOfficeThreadsQuerySchema = z.strictObject({
  limit: z.string().optional(),
  cursor: z.string().min(1).optional(),
});

export const createOfficeMessageRequestSchema = z.strictObject({
  body: z.string().min(1).max(OFFICE_MESSAGE_BODY_MAX_LENGTH),
  parentMessageId: officeMessageIdSchema.optional(),
  mentions: z.array(officeMessageMentionSchema).max(32).optional(),
  references: z.array(officeMessageReferenceSchema).max(16).optional(),
  idempotencyKey: z
    .string()
    .min(1)
    .max(OFFICE_MESSAGE_IDEMPOTENCY_KEY_MAX_LENGTH)
    .optional(),
});

export const officeMessageResourceSchema = z.strictObject({
  id: officeMessageIdSchema,
  workspaceId: workspaceIdSchema,
  threadId: officeThreadIdSchema,
  sequence: z.number().int().positive(),
  authorType: officeMessageAuthorTypeSchema,
  authorUserId: userIdSchema.optional(),
  body: z.string().min(1),
  parentMessageId: officeMessageIdSchema.optional(),
  mentions: z.array(officeMessageMentionSchema),
  references: z.array(officeMessageReferenceSchema),
  createdAt: z.string().min(1),
});

export const officeMessageListResourceSchema = z.strictObject({
  items: z.array(officeMessageResourceSchema),
  nextCursor: z.string().min(1).optional(),
});

export const listOfficeMessagesQuerySchema = z.strictObject({
  limit: z.string().optional(),
  cursor: z.string().min(1).optional(),
});

export const inboxItemResourceSchema = z.strictObject({
  id: z.string().min(1),
  kind: inboxItemKindSchema,
  occurredAt: z.string().min(1),
  unread: z.boolean(),
  title: z.string().min(1),
  summary: z.string().min(1).optional(),
  threadId: officeThreadIdSchema.optional(),
  messageId: officeMessageIdSchema.optional(),
  approvalRequestId: approvalRequestIdSchema.optional(),
  assignmentId: assignmentIdSchema.optional(),
  runId: runIdSchema.optional(),
  workflowRunId: workflowRunIdSchema.optional(),
  artifactId: artifactIdSchema.optional(),
});

export const inboxListResourceSchema = z.strictObject({
  items: z.array(inboxItemResourceSchema),
  nextCursor: z.string().min(1).optional(),
});

export const listInboxQuerySchema = z.strictObject({
  limit: z.string().optional(),
  cursor: z.string().min(1).optional(),
});

export const updateInboxThreadReadStateRequestSchema = z.strictObject({
  threadId: officeThreadIdSchema,
  lastReadSequence: z.number().int().nonnegative(),
});

export const updateInboxItemReadStateRequestSchema = z.strictObject({
  itemId: z.string().min(1),
});

export const updateInboxReadStateRequestSchema = z.union([
  updateInboxThreadReadStateRequestSchema,
  updateInboxItemReadStateRequestSchema,
]);

export const inboxReadStateResourceSchema = z.strictObject({
  threadId: officeThreadIdSchema,
  lastReadSequence: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
});

export const inboxItemReadStateResourceSchema = z.strictObject({
  itemId: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const inboxReadStateMutationResourceSchema = z.union([
  inboxReadStateResourceSchema,
  inboxItemReadStateResourceSchema,
]);

export const officeThreadListCursorPayloadSchema = z.strictObject({
  updatedAt: z.string().min(1),
  id: officeThreadIdSchema,
});

export const officeMessageListCursorPayloadSchema = z.strictObject({
  sequence: z.number().int().positive(),
  id: officeMessageIdSchema,
});

export const inboxListCursorPayloadSchema = z.strictObject({
  occurredAt: z.string().min(1),
  id: z.string().min(1),
});

export function parseOfficeCollaborationPageLimit(
  raw: string | undefined,
): number {
  if (raw === undefined || raw.trim().length === 0) {
    return OFFICE_COLLABORATION_DEFAULT_PAGE_SIZE;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return OFFICE_COLLABORATION_DEFAULT_PAGE_SIZE;
  }
  return Math.min(parsed, OFFICE_COLLABORATION_MAX_PAGE_SIZE);
}
