import type {
  InboxItemResourceV1,
  OfficeMessageId,
  OfficeThreadId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  inboxListCursorPayloadSchema,
  officeMessageListCursorPayloadSchema,
  officeThreadListCursorPayloadSchema,
} from "@osva-ai/contracts/schemas";
import {
  DomainInvariantError,
  OfficeMessageIdempotencyConflictError,
  buildApprovalInboxItem,
  buildAssignmentInboxItem,
  buildChatInboxItem,
  buildDeliverableInboxItem,
  paginateInboxItems,
  parseOperationalInboxItemId,
  sortInboxItemsDescending,
  type InboxItemReadState,
  type InboxReadState,
  type OfficeCollaborationRepository,
  type OfficeMessage,
  type OfficeThread,
  type AppendOfficeMessageRepositoryCommand,
  type ListInboxQuery,
  type ListInboxResult,
  type ListOfficeMessagesQuery,
  type ListOfficeMessagesResult,
  type ListOfficeThreadsQuery,
  type ListOfficeThreadsResult,
} from "@osva/domain";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import type { Database } from "../database.js";
import { approvalRequestFromRow } from "../mappers/approval-request-mapper.js";
import { artifactFromRow } from "../mappers/artifact-mapper.js";
import { assignmentFromRow } from "../mappers/office-mapper.js";
import {
  inboxItemReadStateFromRow,
  inboxItemReadStateToRow,
  inboxReadStateFromRow,
  inboxReadStateToRow,
  officeMessageFromRow,
  officeMessageToRow,
  officeThreadFromRow,
  officeThreadToRow,
} from "../mappers/office-collaboration-mapper.js";
import {
  POSTGRES_UNIQUE_VIOLATION,
  mapDatabaseError,
  postgresConstraintName,
  postgresErrorCode,
} from "../postgres-errors.js";
import { approvalRequests } from "../schema/approval-requests.js";
import { artifacts } from "../schema/artifacts.js";
import { assignments } from "../schema/assignments.js";
import { officeInboxItemReadStates } from "../schema/office-inbox-item-read-states.js";
import { officeInboxReadStates } from "../schema/office-inbox-read-states.js";
import { officeMessages } from "../schema/office-messages.js";
import { officeThreads } from "../schema/office-threads.js";

function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeThreadCursor(cursor: string): {
  readonly updatedAt: string;
  readonly id: OfficeThreadId;
} {
  try {
    return officeThreadListCursorPayloadSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw new DomainInvariantError("Invalid office thread list cursor.");
  }
}

function decodeMessageCursor(cursor: string): {
  readonly sequence: number;
  readonly id: OfficeMessageId;
} {
  try {
    return officeMessageListCursorPayloadSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw new DomainInvariantError("Invalid office message list cursor.");
  }
}

function decodeInboxCursor(cursor: string): {
  readonly occurredAt: string;
  readonly id: string;
} {
  try {
    return inboxListCursorPayloadSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw new DomainInvariantError("Invalid inbox list cursor.");
  }
}

function messageMentionsUser(message: OfficeMessage, userId: UserId): boolean {
  return message.mentions.some(
    (mention) => mention.kind === "HUMAN" && mention.userId === userId,
  );
}

export class PostgresOfficeCollaborationRepository implements OfficeCollaborationRepository {
  constructor(private readonly database: Database) {}

  async saveOfficeThread(thread: OfficeThread): Promise<void> {
    try {
      await this.database.db
        .insert(officeThreads)
        .values(officeThreadToRow(thread));
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findOfficeThreadByWorkspaceAndId(
    workspaceId: WorkspaceId,
    threadId: OfficeThreadId,
  ): Promise<OfficeThread | null> {
    const [row] = await this.database.db
      .select()
      .from(officeThreads)
      .where(
        and(
          eq(officeThreads.workspaceId, workspaceId),
          eq(officeThreads.id, threadId),
        ),
      )
      .limit(1);
    return row === undefined ? null : officeThreadFromRow(row);
  }

  async listOfficeThreads(
    query: ListOfficeThreadsQuery,
  ): Promise<ListOfficeThreadsResult> {
    const conditions = [eq(officeThreads.workspaceId, query.workspaceId)];
    if (query.cursor !== undefined) {
      const cursor = decodeThreadCursor(query.cursor);
      const cursorAt = new Date(cursor.updatedAt);
      conditions.push(
        or(
          lt(officeThreads.updatedAt, cursorAt),
          and(
            eq(officeThreads.updatedAt, cursorAt),
            lt(officeThreads.id, cursor.id),
          ),
        )!,
      );
    }

    const rows = await this.database.db
      .select()
      .from(officeThreads)
      .where(and(...conditions))
      .orderBy(desc(officeThreads.updatedAt), desc(officeThreads.id))
      .limit(query.limit + 1);

    const items = rows.slice(0, query.limit).map(officeThreadFromRow);
    const hasMore = rows.length > query.limit;
    const next =
      hasMore && items.length > 0
        ? encodeCursor({
            updatedAt: items.at(-1)!.updatedAt.toISOString(),
            id: items.at(-1)!.id,
          })
        : undefined;

    return { items, nextCursor: next };
  }

  async appendOfficeMessage(
    command: AppendOfficeMessageRepositoryCommand,
  ): Promise<void> {
    try {
      await this.database.db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(officeThreads)
          .where(
            and(
              eq(officeThreads.workspaceId, command.message.workspaceId),
              eq(officeThreads.id, command.message.threadId),
            ),
          )
          .for("update")
          .limit(1);

        if (locked === undefined) {
          throw mapDatabaseError(
            new Error("Office thread not found for append."),
          );
        }

        if (locked.latestMessageSequence + 1 !== command.message.sequence) {
          throw mapDatabaseError(
            new Error("Office message sequence is out of date."),
          );
        }

        await tx
          .insert(officeMessages)
          .values(officeMessageToRow(command.message));
        await tx
          .update(officeThreads)
          .set({
            latestMessageSequence: command.nextThread.latestMessageSequence,
            updatedAt: command.nextThread.updatedAt,
          })
          .where(eq(officeThreads.id, command.nextThread.id));
      });
    } catch (error) {
      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) ===
          "office_messages_workspace_thread_idempotency_unique"
      ) {
        throw new OfficeMessageIdempotencyConflictError(
          command.message.workspaceId,
          command.message.threadId,
          command.message.idempotencyKey ?? "",
        );
      }

      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) ===
          "office_messages_thread_id_sequence_unique"
      ) {
        throw mapDatabaseError(error);
      }

      throw mapDatabaseError(error);
    }
  }

  async findOfficeMessageByWorkspaceThreadAndIdempotencyKey(
    workspaceId: WorkspaceId,
    threadId: OfficeThreadId,
    idempotencyKey: string,
  ): Promise<OfficeMessage | null> {
    const [row] = await this.database.db
      .select()
      .from(officeMessages)
      .where(
        and(
          eq(officeMessages.workspaceId, workspaceId),
          eq(officeMessages.threadId, threadId),
          eq(officeMessages.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row === undefined ? null : officeMessageFromRow(row);
  }

  async findOfficeMessageByWorkspaceThreadAndId(
    workspaceId: WorkspaceId,
    threadId: OfficeThreadId,
    messageId: OfficeMessageId,
  ): Promise<OfficeMessage | null> {
    const [row] = await this.database.db
      .select()
      .from(officeMessages)
      .where(
        and(
          eq(officeMessages.workspaceId, workspaceId),
          eq(officeMessages.threadId, threadId),
          eq(officeMessages.id, messageId),
        ),
      )
      .limit(1);
    return row === undefined ? null : officeMessageFromRow(row);
  }

  async listOfficeMessages(
    query: ListOfficeMessagesQuery,
  ): Promise<ListOfficeMessagesResult> {
    const conditions = [
      eq(officeMessages.workspaceId, query.workspaceId),
      eq(officeMessages.threadId, query.threadId),
    ];

    if (query.cursor !== undefined) {
      const cursor = decodeMessageCursor(query.cursor);
      conditions.push(
        or(
          gt(officeMessages.sequence, cursor.sequence),
          and(
            eq(officeMessages.sequence, cursor.sequence),
            gt(officeMessages.id, cursor.id),
          ),
        )!,
      );
    }

    const rows = await this.database.db
      .select()
      .from(officeMessages)
      .where(and(...conditions))
      .orderBy(asc(officeMessages.sequence), asc(officeMessages.id))
      .limit(query.limit + 1);

    const items = rows.slice(0, query.limit).map(officeMessageFromRow);
    const hasMore = rows.length > query.limit;
    const next =
      hasMore && items.length > 0
        ? encodeCursor({
            sequence: items.at(-1)!.sequence,
            id: items.at(-1)!.id,
          })
        : undefined;

    return { items, nextCursor: next };
  }

  async upsertInboxReadState(state: InboxReadState): Promise<void> {
    const row = inboxReadStateToRow(state);
    await this.database.db
      .insert(officeInboxReadStates)
      .values(row)
      .onConflictDoUpdate({
        target: [
          officeInboxReadStates.workspaceId,
          officeInboxReadStates.userId,
          officeInboxReadStates.threadId,
        ],
        set: {
          lastReadSequence: row.lastReadSequence,
          updatedAt: row.updatedAt,
        },
      });
  }

  async findInboxReadState(
    workspaceId: WorkspaceId,
    userId: UserId,
    threadId: OfficeThreadId,
  ): Promise<InboxReadState | null> {
    const [row] = await this.database.db
      .select()
      .from(officeInboxReadStates)
      .where(
        and(
          eq(officeInboxReadStates.workspaceId, workspaceId),
          eq(officeInboxReadStates.userId, userId),
          eq(officeInboxReadStates.threadId, threadId),
        ),
      )
      .limit(1);
    return row === undefined ? null : inboxReadStateFromRow(row);
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

    const [result] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(officeMessages)
      .where(
        and(
          eq(officeMessages.workspaceId, workspaceId),
          eq(officeMessages.threadId, threadId),
          gt(officeMessages.sequence, lastRead),
          sql`(${officeMessages.authorUserId} IS NULL OR ${officeMessages.authorUserId} <> ${userId})`,
        ),
      );

    return result?.count ?? 0;
  }

  async upsertInboxItemReadState(state: InboxItemReadState): Promise<void> {
    const row = inboxItemReadStateToRow(state);
    await this.database.db
      .insert(officeInboxItemReadStates)
      .values(row)
      .onConflictDoUpdate({
        target: [
          officeInboxItemReadStates.workspaceId,
          officeInboxItemReadStates.userId,
          officeInboxItemReadStates.itemId,
        ],
        set: {
          updatedAt: row.updatedAt,
        },
      });
  }

  async findInboxItemReadState(
    workspaceId: WorkspaceId,
    userId: UserId,
    itemId: string,
  ): Promise<InboxItemReadState | null> {
    const [row] = await this.database.db
      .select()
      .from(officeInboxItemReadStates)
      .where(
        and(
          eq(officeInboxItemReadStates.workspaceId, workspaceId),
          eq(officeInboxItemReadStates.userId, userId),
          eq(officeInboxItemReadStates.itemId, itemId),
        ),
      )
      .limit(1);
    return row === undefined ? null : inboxItemReadStateFromRow(row);
  }

  async isOperationalInboxItemAcknowledgeable(
    workspaceId: WorkspaceId,
    itemId: string,
  ): Promise<boolean> {
    const parsed = parseOperationalInboxItemId(itemId);
    if (parsed === null) {
      return false;
    }

    switch (parsed.kind) {
      case "approval": {
        const [row] = await this.database.db
          .select({ id: approvalRequests.id })
          .from(approvalRequests)
          .where(
            and(
              eq(approvalRequests.workspaceId, workspaceId),
              eq(approvalRequests.id, parsed.approvalRequestId),
              eq(approvalRequests.status, "PENDING"),
            ),
          )
          .limit(1);
        return row !== undefined;
      }
      case "assignment": {
        const [row] = await this.database.db
          .select({ id: assignments.id })
          .from(assignments)
          .where(
            and(
              eq(assignments.workspaceId, workspaceId),
              eq(assignments.id, parsed.assignmentId),
              eq(assignments.status, parsed.status),
            ),
          )
          .limit(1);
        return row !== undefined;
      }
      case "deliverable": {
        const rows = await this.database.db
          .select({ id: artifacts.id })
          .from(artifacts)
          .innerJoin(
            assignments,
            and(
              eq(assignments.workspaceId, artifacts.workspaceId),
              eq(assignments.runId, artifacts.producerRunId),
              eq(assignments.status, "COMPLETED"),
            ),
          )
          .where(
            and(
              eq(artifacts.workspaceId, workspaceId),
              eq(artifacts.id, parsed.artifactId),
              isNotNull(artifacts.producerRunId),
            ),
          )
          .limit(1);
        return rows.length > 0;
      }
      default: {
        const _exhaustive: never = parsed;
        throw _exhaustive;
      }
    }
  }

  async listAcknowledgedInboxItemIds(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<ReadonlySet<string>> {
    const rows = await this.database.db
      .select({ itemId: officeInboxItemReadStates.itemId })
      .from(officeInboxItemReadStates)
      .where(
        and(
          eq(officeInboxItemReadStates.workspaceId, workspaceId),
          eq(officeInboxItemReadStates.userId, userId),
        ),
      );
    return new Set(rows.map((row) => row.itemId));
  }

  async listInboxItems(query: ListInboxQuery): Promise<ListInboxResult> {
    const threadRows = await this.database.db
      .select({
        thread: officeThreads,
      })
      .from(officeThreads)
      .where(eq(officeThreads.workspaceId, query.workspaceId));

    const threadTitleById = new Map(
      threadRows.map((row) => [row.thread.id, row.thread.title] as const),
    );

    const messageRows = await this.database.db
      .select()
      .from(officeMessages)
      .where(eq(officeMessages.workspaceId, query.workspaceId))
      .orderBy(desc(officeMessages.createdAt), desc(officeMessages.id));

    const acknowledged = await this.listAcknowledgedInboxItemIds(
      query.workspaceId,
      query.userId,
    );

    const unreadItems: InboxItemResourceV1[] = [];
    for (const row of messageRows) {
      const message = officeMessageFromRow(row);
      if (message.authorUserId === query.userId) {
        continue;
      }

      const readState = await this.findInboxReadState(
        query.workspaceId,
        query.userId,
        message.threadId,
      );
      const lastRead = readState?.lastReadSequence ?? 0;
      if (message.sequence <= lastRead) {
        continue;
      }

      const title = threadTitleById.get(message.threadId) ?? "Conversation";
      unreadItems.push(
        buildChatInboxItem({
          message,
          threadTitle: title,
          mentioned: messageMentionsUser(message, query.userId),
        }),
      );
    }

    const workflowAssignmentRows = await this.database.db
      .select({
        id: assignments.id,
        workflowRunId: assignments.workflowRunId,
      })
      .from(assignments)
      .where(
        and(
          eq(assignments.workspaceId, query.workspaceId),
          isNotNull(assignments.workflowRunId),
        ),
      );

    const assignmentIdByWorkflowRunId = new Map<string, string>();
    for (const row of workflowAssignmentRows) {
      if (row.workflowRunId === null) {
        continue;
      }
      if (!assignmentIdByWorkflowRunId.has(row.workflowRunId)) {
        assignmentIdByWorkflowRunId.set(row.workflowRunId, row.id);
      }
    }

    const approvalRows = await this.database.db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.workspaceId, query.workspaceId),
          eq(approvalRequests.status, "PENDING"),
        ),
      );

    for (const row of approvalRows) {
      const approval = approvalRequestFromRow(row);
      const assignmentId = assignmentIdByWorkflowRunId.get(
        approval.workflowRunId,
      );
      const item = buildApprovalInboxItem(
        approval,
        assignmentId === undefined
          ? undefined
          : { assignmentId: assignmentId as never },
      );
      if (!acknowledged.has(item.id)) {
        unreadItems.push(item);
      }
    }

    const assignmentRows = await this.database.db
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.workspaceId, query.workspaceId),
          inArray(assignments.status, ["FAILED", "CANCELLED"]),
        ),
      );

    for (const row of assignmentRows) {
      const item = buildAssignmentInboxItem(assignmentFromRow(row));
      if (item !== null && !acknowledged.has(item.id)) {
        unreadItems.push(item);
      }
    }

    const deliverableRows = await this.database.db
      .select({
        artifact: artifacts,
        assignment: assignments,
      })
      .from(artifacts)
      .innerJoin(
        assignments,
        and(
          eq(assignments.workspaceId, artifacts.workspaceId),
          eq(assignments.runId, artifacts.producerRunId),
          eq(assignments.status, "COMPLETED"),
        ),
      )
      .where(
        and(
          eq(artifacts.workspaceId, query.workspaceId),
          isNotNull(artifacts.producerRunId),
        ),
      );

    for (const row of deliverableRows) {
      const assignment = assignmentFromRow(row.assignment);
      const artifact = artifactFromRow(row.artifact);
      const item = buildDeliverableInboxItem({
        artifact,
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        runId: assignment.runId,
      });
      if (!acknowledged.has(item.id)) {
        unreadItems.push(item);
      }
    }

    const deduped = new Map<string, InboxItemResourceV1>();
    for (const item of unreadItems) {
      deduped.set(item.id, item);
    }
    const sorted = sortInboxItemsDescending([...deduped.values()]);
    const paged = paginateInboxItems({
      items: sorted,
      limit: query.limit,
      cursor:
        query.cursor === undefined
          ? undefined
          : decodeInboxCursor(query.cursor),
    });
    const nextCursor =
      paged.nextCursor === undefined
        ? undefined
        : encodeCursor(paged.nextCursor);

    return { items: paged.items, nextCursor };
  }
}
