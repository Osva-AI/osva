import type {
  InboxItemResourceV1,
  OfficeMessageId,
  OfficeMessageReferenceV1,
  OfficeMessageMentionV1,
  OfficeThreadId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";

import type { InboxReadState } from "../inbox-read-state.js";
import type { OfficeMessage } from "../office-message.js";
import type { OfficeThread } from "../office-thread.js";

export interface ListOfficeThreadsQuery {
  readonly workspaceId: WorkspaceId;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListOfficeThreadsResult {
  readonly items: readonly OfficeThread[];
  readonly nextCursor?: string;
}

export interface ListOfficeMessagesQuery {
  readonly workspaceId: WorkspaceId;
  readonly threadId: OfficeThreadId;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListOfficeMessagesResult {
  readonly items: readonly OfficeMessage[];
  readonly nextCursor?: string;
}

export interface ListInboxQuery {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListInboxResult {
  readonly items: readonly InboxItemResourceV1[];
  readonly nextCursor?: string;
}

export interface AppendOfficeMessageRepositoryCommand {
  readonly message: OfficeMessage;
  readonly nextThread: OfficeThread;
}

export interface OfficeCollaborationRepository {
  saveOfficeThread(thread: OfficeThread): Promise<void>;
  findOfficeThreadByWorkspaceAndId(
    workspaceId: WorkspaceId,
    threadId: OfficeThreadId,
  ): Promise<OfficeThread | null>;
  listOfficeThreads(
    query: ListOfficeThreadsQuery,
  ): Promise<ListOfficeThreadsResult>;

  appendOfficeMessage(
    command: AppendOfficeMessageRepositoryCommand,
  ): Promise<void>;
  findOfficeMessageByWorkspaceThreadAndIdempotencyKey(
    workspaceId: WorkspaceId,
    threadId: OfficeThreadId,
    idempotencyKey: string,
  ): Promise<OfficeMessage | null>;
  findOfficeMessageByWorkspaceThreadAndId(
    workspaceId: WorkspaceId,
    threadId: OfficeThreadId,
    messageId: OfficeMessageId,
  ): Promise<OfficeMessage | null>;
  listOfficeMessages(
    query: ListOfficeMessagesQuery,
  ): Promise<ListOfficeMessagesResult>;

  upsertInboxReadState(state: InboxReadState): Promise<void>;
  findInboxReadState(
    workspaceId: WorkspaceId,
    userId: UserId,
    threadId: OfficeThreadId,
  ): Promise<InboxReadState | null>;
  countUnreadMessagesForUser(
    workspaceId: WorkspaceId,
    userId: UserId,
    threadId: OfficeThreadId,
  ): Promise<number>;

  listInboxItems(query: ListInboxQuery): Promise<ListInboxResult>;
}

export interface ValidateOfficeMessageContextInput {
  readonly workspaceId: WorkspaceId;
  readonly mentions: readonly OfficeMessageMentionV1[];
  readonly references: readonly OfficeMessageReferenceV1[];
}
