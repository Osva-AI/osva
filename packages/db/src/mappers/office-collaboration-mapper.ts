import type {
  GoalId,
  OfficeMessageId,
  OfficeMessageMentionV1,
  OfficeMessageReferenceV1,
  OfficeThreadId,
  TeamId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";

import { InboxItemReadState, InboxReadState } from "@osva/domain";
import { OfficeMessage } from "@osva/domain";
import { OfficeThread } from "@osva/domain";

import type {
  officeInboxItemReadStates,
  officeInboxReadStates,
  officeMessages,
  officeThreads,
} from "../schema/index.js";

type OfficeThreadRow = typeof officeThreads.$inferSelect;
type OfficeThreadInsert = typeof officeThreads.$inferInsert;
type OfficeMessageRow = typeof officeMessages.$inferSelect;
type OfficeMessageInsert = typeof officeMessages.$inferInsert;
type InboxReadStateRow = typeof officeInboxReadStates.$inferSelect;
type InboxReadStateInsert = typeof officeInboxReadStates.$inferInsert;
type InboxItemReadStateRow = typeof officeInboxItemReadStates.$inferSelect;
type InboxItemReadStateInsert = typeof officeInboxItemReadStates.$inferInsert;

function parseMentions(value: unknown): readonly OfficeMessageMentionV1[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as readonly OfficeMessageMentionV1[];
}

function parseReferences(value: unknown): readonly OfficeMessageReferenceV1[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as readonly OfficeMessageReferenceV1[];
}

export function officeThreadToRow(thread: OfficeThread): OfficeThreadInsert {
  return {
    id: thread.id,
    workspaceId: thread.workspaceId,
    title: thread.title,
    type: thread.type,
    teamId: thread.teamId,
    goalId: thread.goalId,
    createdByUserId: thread.createdByUserId,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    latestMessageSequence: thread.latestMessageSequence,
  };
}

export function officeThreadFromRow(row: OfficeThreadRow): OfficeThread {
  return OfficeThread.rehydrate({
    id: row.id as OfficeThreadId,
    workspaceId: row.workspaceId as WorkspaceId,
    title: row.title,
    type: row.type as OfficeThread["type"],
    teamId: (row.teamId ?? undefined) as TeamId | undefined,
    goalId: (row.goalId ?? undefined) as GoalId | undefined,
    createdByUserId: row.createdByUserId as UserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    latestMessageSequence: row.latestMessageSequence,
  });
}

export function officeMessageToRow(
  message: OfficeMessage,
): OfficeMessageInsert {
  return {
    id: message.id,
    workspaceId: message.workspaceId,
    threadId: message.threadId,
    sequence: message.sequence,
    authorType: message.authorType,
    authorUserId: message.authorUserId,
    authorOfficeWorkerId: undefined,
    body: message.body,
    parentMessageId: message.parentMessageId,
    mentions: message.mentions,
    resourceReferences: message.references,
    idempotencyKey: message.idempotencyKey,
    createdAt: message.createdAt,
  };
}

export function officeMessageFromRow(row: OfficeMessageRow): OfficeMessage {
  return OfficeMessage.rehydrate({
    id: row.id as OfficeMessageId,
    workspaceId: row.workspaceId as WorkspaceId,
    threadId: row.threadId as OfficeThreadId,
    sequence: row.sequence,
    authorType: row.authorType as OfficeMessage["authorType"],
    authorUserId: (row.authorUserId ?? undefined) as UserId | undefined,
    body: row.body,
    parentMessageId: (row.parentMessageId ?? undefined) as
      OfficeMessageId | undefined,
    mentions: parseMentions(row.mentions),
    references: parseReferences(row.resourceReferences),
    idempotencyKey: row.idempotencyKey ?? undefined,
    createdAt: row.createdAt,
  });
}

export function inboxReadStateToRow(
  state: InboxReadState,
): InboxReadStateInsert {
  return {
    workspaceId: state.workspaceId,
    userId: state.userId,
    threadId: state.threadId,
    lastReadSequence: state.lastReadSequence,
    updatedAt: state.updatedAt,
  };
}

export function inboxReadStateFromRow(row: InboxReadStateRow): InboxReadState {
  return InboxReadState.rehydrate({
    workspaceId: row.workspaceId as WorkspaceId,
    userId: row.userId as UserId,
    threadId: row.threadId as OfficeThreadId,
    lastReadSequence: row.lastReadSequence,
    updatedAt: row.updatedAt,
  });
}

export function inboxItemReadStateToRow(
  state: InboxItemReadState,
): InboxItemReadStateInsert {
  return {
    workspaceId: state.workspaceId,
    userId: state.userId,
    itemId: state.itemId,
    updatedAt: state.updatedAt,
  };
}

export function inboxItemReadStateFromRow(
  row: InboxItemReadStateRow,
): InboxItemReadState {
  return InboxItemReadState.rehydrate({
    workspaceId: row.workspaceId as WorkspaceId,
    userId: row.userId as UserId,
    itemId: row.itemId,
    updatedAt: row.updatedAt,
  });
}
