import type {
  InboxItemResourceV1,
  OfficeMessageId,
  OfficeThreadId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  OfficeMessageIdempotencyConflictError,
  type AppendOfficeMessageRepositoryCommand,
  type ListInboxQuery,
  type ListInboxResult,
  type ListOfficeMessagesQuery,
  type ListOfficeMessagesResult,
  type ListOfficeThreadsQuery,
  type ListOfficeThreadsResult,
  type OfficeCollaborationRepository,
} from "@osva/domain";
import type { InboxReadState, OfficeMessage, OfficeThread } from "@osva/domain";

function encodeCursor(payload: unknown): string {
  return JSON.stringify(payload);
}

export class MemoryOfficeCollaborationRepository implements OfficeCollaborationRepository {
  private readonly threads = new Map<OfficeThreadId, OfficeThread>();
  private readonly messages = new Map<OfficeMessageId, OfficeMessage>();
  private readonly readStates = new Map<string, InboxReadState>();

  async saveOfficeThread(thread: OfficeThread): Promise<void> {
    this.threads.set(thread.id, thread);
  }

  async findOfficeThreadByWorkspaceAndId(
    workspaceId: WorkspaceId,
    threadId: OfficeThreadId,
  ): Promise<OfficeThread | null> {
    const thread = this.threads.get(threadId);
    if (thread === undefined || thread.workspaceId !== workspaceId) {
      return null;
    }
    return thread;
  }

  async listOfficeThreads(
    query: ListOfficeThreadsQuery,
  ): Promise<ListOfficeThreadsResult> {
    const items = [...this.threads.values()]
      .filter((thread) => thread.workspaceId === query.workspaceId)
      .sort((left, right) => {
        const byUpdated = right.updatedAt.getTime() - left.updatedAt.getTime();
        if (byUpdated !== 0) {
          return byUpdated;
        }
        return right.id.localeCompare(left.id);
      });

    const page = items.slice(0, query.limit);
    const hasMore = items.length > query.limit;
    return {
      items: page,
      nextCursor:
        hasMore && page.length > 0
          ? encodeCursor({
              updatedAt: page.at(-1)!.updatedAt.toISOString(),
              id: page.at(-1)!.id,
            })
          : undefined,
    };
  }

  async appendOfficeMessage(
    command: AppendOfficeMessageRepositoryCommand,
  ): Promise<void> {
    const existing = command.message.idempotencyKey
      ? [...this.messages.values()].find(
          (message) =>
            message.workspaceId === command.message.workspaceId &&
            message.threadId === command.message.threadId &&
            message.idempotencyKey === command.message.idempotencyKey,
        )
      : undefined;
    if (existing !== undefined) {
      throw new OfficeMessageIdempotencyConflictError(
        command.message.workspaceId,
        command.message.threadId,
        command.message.idempotencyKey ?? "",
      );
    }

    this.messages.set(command.message.id, command.message);
    this.threads.set(command.nextThread.id, command.nextThread);
  }

  async findOfficeMessageByWorkspaceThreadAndIdempotencyKey(
    workspaceId: WorkspaceId,
    threadId: OfficeThreadId,
    idempotencyKey: string,
  ): Promise<OfficeMessage | null> {
    const message = [...this.messages.values()].find(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.threadId === threadId &&
        candidate.idempotencyKey === idempotencyKey,
    );
    return message ?? null;
  }

  async findOfficeMessageByWorkspaceThreadAndId(
    workspaceId: WorkspaceId,
    threadId: OfficeThreadId,
    messageId: OfficeMessageId,
  ): Promise<OfficeMessage | null> {
    const message = this.messages.get(messageId);
    if (
      message === undefined ||
      message.workspaceId !== workspaceId ||
      message.threadId !== threadId
    ) {
      return null;
    }
    return message;
  }

  async listOfficeMessages(
    query: ListOfficeMessagesQuery,
  ): Promise<ListOfficeMessagesResult> {
    const items = [...this.messages.values()]
      .filter(
        (message) =>
          message.workspaceId === query.workspaceId &&
          message.threadId === query.threadId,
      )
      .sort((left, right) => {
        if (left.sequence !== right.sequence) {
          return left.sequence - right.sequence;
        }
        return left.id.localeCompare(right.id);
      });
    return { items: items.slice(0, query.limit) };
  }

  async upsertInboxReadState(state: InboxReadState): Promise<void> {
    const key = `${state.workspaceId}:${state.userId}:${state.threadId}`;
    this.readStates.set(key, state);
  }

  async findInboxReadState(
    workspaceId: WorkspaceId,
    userId: UserId,
    threadId: OfficeThreadId,
  ): Promise<InboxReadState | null> {
    return this.readStates.get(`${workspaceId}:${userId}:${threadId}`) ?? null;
  }

  async countUnreadMessagesForUser(
    workspaceId: WorkspaceId,
    userId: UserId,
    threadId: OfficeThreadId,
  ): Promise<number> {
    const readState = await this.findInboxReadState(
      workspaceId,
      userId,
      threadId,
    );
    const lastRead = readState?.lastReadSequence ?? 0;
    return [...this.messages.values()].filter(
      (message) =>
        message.workspaceId === workspaceId &&
        message.threadId === threadId &&
        message.sequence > lastRead &&
        message.authorUserId !== userId,
    ).length;
  }

  async listInboxItems(query: ListInboxQuery): Promise<ListInboxResult> {
    const unreadItems: InboxItemResourceV1[] = [];
    for (const message of this.messages.values()) {
      if (
        message.workspaceId !== query.workspaceId ||
        message.authorUserId === query.userId
      ) {
        continue;
      }
      const readState = await this.findInboxReadState(
        query.workspaceId,
        query.userId,
        message.threadId,
      );
      if (message.sequence <= (readState?.lastReadSequence ?? 0)) {
        continue;
      }
      const thread = this.threads.get(message.threadId);
      const mentioned = message.mentions.some(
        (mention) =>
          mention.kind === "HUMAN" && mention.userId === query.userId,
      );
      unreadItems.push({
        id: `chat:${message.id}`,
        kind: mentioned ? "CHAT_MENTION" : "CHAT_MESSAGE",
        occurredAt: message.createdAt.toISOString(),
        unread: true,
        title: thread?.title ?? "Conversation",
        summary: message.body.slice(0, 240),
        threadId: message.threadId,
        messageId: message.id,
      });
    }

    unreadItems.sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt),
    );
    return { items: unreadItems.slice(0, query.limit) };
  }
}
