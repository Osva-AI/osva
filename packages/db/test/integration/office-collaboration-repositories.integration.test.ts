import type {
  OfficeMessageId,
  OfficeThreadId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  InboxReadState,
  OfficeMessage,
  OfficeMessageIdempotencyConflictError,
  OfficeThread,
  Workspace,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresOfficeCollaborationRepository } from "../../src/repositories/postgres-office-collaboration-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const NOW = new Date("2026-03-15T12:00:00.000Z");

describe("PostgreSQL office collaboration repository", () => {
  let context: PostgresTestContext;
  let database: Database;
  let collaboration: PostgresOfficeCollaborationRepository;
  let workspaces: PostgresWorkspaceRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    collaboration = new PostgresOfficeCollaborationRepository(database);
    workspaces = new PostgresWorkspaceRepository(database);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  it("appends messages with monotonic ordering and workspace isolation", async () => {
    const workspaceA = "ws-a" as WorkspaceId;
    const workspaceB = "ws-b" as WorkspaceId;
    await workspaces.save(
      Workspace.create({ id: workspaceA, name: "A", createdAt: NOW }),
    );
    await workspaces.save(
      Workspace.create({ id: workspaceB, name: "B", createdAt: NOW }),
    );

    const threadA = OfficeThread.create({
      id: "thread-a" as OfficeThreadId,
      workspaceId: workspaceA,
      title: "Workspace A",
      createdByUserId: "user-a" as UserId,
      now: NOW,
    });
    await collaboration.saveOfficeThread(threadA);

    const threadB = OfficeThread.create({
      id: "thread-b" as OfficeThreadId,
      workspaceId: workspaceB,
      title: "Workspace B",
      createdByUserId: "user-b" as UserId,
      now: NOW,
    });
    await collaboration.saveOfficeThread(threadB);

    const messageOne = OfficeMessage.createHuman({
      id: "msg-1" as never,
      workspaceId: workspaceA,
      threadId: threadA.id,
      sequence: 1,
      authorUserId: "user-a" as UserId,
      body: "First",
      now: NOW,
    });
    await collaboration.appendOfficeMessage({
      message: messageOne,
      nextThread: threadA.withAppendedMessage({
        now: NOW,
        latestMessageSequence: 1,
      }),
    });

    const messageTwo = OfficeMessage.createHuman({
      id: "msg-2" as never,
      workspaceId: workspaceA,
      threadId: threadA.id,
      sequence: 2,
      authorUserId: "user-b" as UserId,
      body: "Second",
      parentMessageId: messageOne.id,
      now: NOW,
    });
    const updatedThread = (await collaboration.findOfficeThreadByWorkspaceAndId(
      workspaceA,
      threadA.id,
    ))!;
    await collaboration.appendOfficeMessage({
      message: messageTwo,
      nextThread: updatedThread.withAppendedMessage({
        now: NOW,
        latestMessageSequence: 2,
      }),
    });

    const listedA = await collaboration.listOfficeMessages({
      workspaceId: workspaceA,
      threadId: threadA.id,
      limit: 50,
    });
    expect(listedA.items.map((item) => item.sequence)).toEqual([1, 2]);

    const crossWorkspace = await collaboration.findOfficeThreadByWorkspaceAndId(
      workspaceB,
      threadA.id,
    );
    expect(crossWorkspace).toBeNull();
  });

  it("rejects duplicate idempotency keys and preserves monotonic sequences under contention", async () => {
    const workspaceId = "ws-idem" as WorkspaceId;
    await workspaces.save(
      Workspace.create({ id: workspaceId, name: "Idem", createdAt: NOW }),
    );

    const thread = OfficeThread.create({
      id: "thread-idem" as OfficeThreadId,
      workspaceId,
      title: "Idempotent",
      createdByUserId: "user-a" as UserId,
      now: NOW,
    });
    await collaboration.saveOfficeThread(thread);

    const first = OfficeMessage.createHuman({
      id: "msg-idem-1" as OfficeMessageId,
      workspaceId,
      threadId: thread.id,
      sequence: 1,
      authorUserId: "user-a" as UserId,
      body: "Original",
      idempotencyKey: "idem-key-1",
      now: NOW,
    });
    await collaboration.appendOfficeMessage({
      message: first,
      nextThread: thread.withAppendedMessage({
        now: NOW,
        latestMessageSequence: 1,
      }),
    });

    const duplicate = OfficeMessage.createHuman({
      id: "msg-idem-2" as OfficeMessageId,
      workspaceId,
      threadId: thread.id,
      sequence: 2,
      authorUserId: "user-a" as UserId,
      body: "Conflicting body",
      idempotencyKey: "idem-key-1",
      now: NOW,
    });
    const locked = (await collaboration.findOfficeThreadByWorkspaceAndId(
      workspaceId,
      thread.id,
    ))!;
    await expect(
      collaboration.appendOfficeMessage({
        message: duplicate,
        nextThread: locked.withAppendedMessage({
          now: NOW,
          latestMessageSequence: 2,
        }),
      }),
    ).rejects.toBeInstanceOf(OfficeMessageIdempotencyConflictError);

    const byKey =
      await collaboration.findOfficeMessageByWorkspaceThreadAndIdempotencyKey(
        workspaceId,
        thread.id,
        "idem-key-1",
      );
    expect(byKey?.body).toBe("Original");

    const resetThread = (await collaboration.findOfficeThreadByWorkspaceAndId(
      workspaceId,
      thread.id,
    ))!;
    const concurrent = await Promise.allSettled([
      collaboration.appendOfficeMessage({
        message: OfficeMessage.createHuman({
          id: "msg-c1" as OfficeMessageId,
          workspaceId,
          threadId: thread.id,
          sequence: resetThread.latestMessageSequence + 1,
          authorUserId: "user-a" as UserId,
          body: "Concurrent A",
          now: NOW,
        }),
        nextThread: resetThread.withAppendedMessage({
          now: NOW,
          latestMessageSequence: resetThread.latestMessageSequence + 1,
        }),
      }),
      collaboration.appendOfficeMessage({
        message: OfficeMessage.createHuman({
          id: "msg-c2" as OfficeMessageId,
          workspaceId,
          threadId: thread.id,
          sequence: resetThread.latestMessageSequence + 1,
          authorUserId: "user-b" as UserId,
          body: "Concurrent B",
          now: NOW,
        }),
        nextThread: resetThread.withAppendedMessage({
          now: NOW,
          latestMessageSequence: resetThread.latestMessageSequence + 1,
        }),
      }),
    ]);

    const fulfilled = concurrent.filter(
      (result) => result.status === "fulfilled",
    );
    const rejected = concurrent.filter(
      (result) => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const messages = await collaboration.listOfficeMessages({
      workspaceId,
      threadId: thread.id,
      limit: 50,
    });
    const sequences = messages.items.map((message) => message.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it("stores independent per-user read state", async () => {
    const workspaceId = "ws-read" as WorkspaceId;
    await workspaces.save(
      Workspace.create({ id: workspaceId, name: "Read", createdAt: NOW }),
    );
    const threadId = "thread-read" as OfficeThreadId;
    const thread = OfficeThread.create({
      id: threadId,
      workspaceId,
      title: "Read state",
      createdByUserId: "user-a" as UserId,
      now: NOW,
    });
    await collaboration.saveOfficeThread(thread);

    await collaboration.upsertInboxReadState(
      InboxReadState.create({
        workspaceId,
        userId: "user-a" as UserId,
        threadId,
        lastReadSequence: 3,
        now: NOW,
      }),
    );
    await collaboration.upsertInboxReadState(
      InboxReadState.create({
        workspaceId,
        userId: "user-b" as UserId,
        threadId,
        lastReadSequence: 1,
        now: NOW,
      }),
    );

    const a = await collaboration.findInboxReadState(
      workspaceId,
      "user-a" as UserId,
      threadId,
    );
    const b = await collaboration.findInboxReadState(
      workspaceId,
      "user-b" as UserId,
      threadId,
    );
    expect(a?.lastReadSequence).toBe(3);
    expect(b?.lastReadSequence).toBe(1);
  });
});
