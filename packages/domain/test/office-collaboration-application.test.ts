import type {
  OfficeMessageId,
  OfficeThreadId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  AUTHENTICATION_METHODS,
  COMMUNITY_EDITION_ROLES,
  HUMAN_WORKSPACE_ROLES,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import type { Assignment } from "../src/assignment.js";
import type { ControlPlaneScope } from "../src/control-plane.js";
import { HumanPrincipalRequiredError } from "../src/errors.js";
import { InboxReadState } from "../src/inbox-read-state.js";
import { createOfficeCollaborationApplication } from "../src/office-collaboration-application.js";
import { OfficeMessage } from "../src/office-message.js";
import { OfficeThread } from "../src/office-thread.js";
import type {
  AppendOfficeMessageRepositoryCommand,
  ListInboxQuery,
  ListInboxResult,
  ListOfficeMessagesQuery,
  ListOfficeMessagesResult,
  ListOfficeThreadsQuery,
  ListOfficeThreadsResult,
  OfficeCollaborationRepository,
} from "../src/ports/office-collaboration-repository.js";
import type { OfficeRepository } from "../src/ports/office-repository.js";
import type { WorkspaceMembershipRepository } from "../src/ports/workspace-membership-repository.js";
import type { WorkspaceRepository } from "../src/ports/workspace-repository.js";
import { Workspace } from "../src/workspace.js";

const WORKSPACE = "ws-office-chat" as WorkspaceId;
const USER_A = "user-a" as UserId;
const USER_B = "user-b" as UserId;
const NOW = new Date("2026-03-15T12:00:00.000Z");

class InMemoryCollaborationRepository implements OfficeCollaborationRepository {
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
    return thread?.workspaceId === workspaceId ? thread : null;
  }

  async listOfficeThreads(
    query: ListOfficeThreadsQuery,
  ): Promise<ListOfficeThreadsResult> {
    const items = [...this.threads.values()].filter(
      (thread) => thread.workspaceId === query.workspaceId,
    );
    return { items: items.slice(0, query.limit) };
  }

  async appendOfficeMessage(
    command: AppendOfficeMessageRepositoryCommand,
  ): Promise<void> {
    this.messages.set(command.message.id, command.message);
    this.threads.set(command.nextThread.id, command.nextThread);
  }

  async findOfficeMessageByWorkspaceThreadAndIdempotencyKey() {
    return null;
  }

  async findOfficeMessageByWorkspaceThreadAndId(
    workspaceId: WorkspaceId,
    threadId: OfficeThreadId,
    messageId: OfficeMessageId,
  ) {
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
      .sort((left, right) => left.sequence - right.sequence);
    return { items: items.slice(0, query.limit) };
  }

  async upsertInboxReadState(state: InboxReadState): Promise<void> {
    this.readStates.set(
      `${state.workspaceId}:${state.userId}:${state.threadId}`,
      state,
    );
  }

  async findInboxReadState(
    workspaceId: WorkspaceId,
    userId: UserId,
    threadId: OfficeThreadId,
  ) {
    return this.readStates.get(`${workspaceId}:${userId}:${threadId}`) ?? null;
  }

  async countUnreadMessagesForUser(
    workspaceId: WorkspaceId,
    userId: UserId,
    threadId: OfficeThreadId,
  ) {
    const lastRead =
      (await this.findInboxReadState(workspaceId, userId, threadId))
        ?.lastReadSequence ?? 0;
    return [...this.messages.values()].filter(
      (message) =>
        message.workspaceId === workspaceId &&
        message.threadId === threadId &&
        message.sequence > lastRead &&
        message.authorUserId !== userId,
    ).length;
  }

  async listInboxItems(query: ListInboxQuery): Promise<ListInboxResult> {
    const items = [];
    for (const message of this.messages.values()) {
      if (
        message.workspaceId !== query.workspaceId ||
        message.authorUserId === query.userId
      ) {
        continue;
      }
      const lastRead =
        (
          await this.findInboxReadState(
            query.workspaceId,
            query.userId,
            message.threadId,
          )
        )?.lastReadSequence ?? 0;
      if (message.sequence <= lastRead) {
        continue;
      }
      const thread = this.threads.get(message.threadId);
      items.push({
        id: `chat:${message.id}`,
        kind: "CHAT_MESSAGE" as const,
        occurredAt: message.createdAt.toISOString(),
        unread: true,
        title: thread?.title ?? "Conversation",
        threadId: message.threadId,
        messageId: message.id,
      });
    }
    return { items: items.slice(0, query.limit) };
  }
}

class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly items = new Map<WorkspaceId, Workspace>();

  async save(workspace: Workspace): Promise<void> {
    this.items.set(workspace.id, workspace);
  }

  async findById(id: WorkspaceId) {
    return this.items.get(id) ?? null;
  }

  async countAll(): Promise<number> {
    return this.items.size;
  }

  async listIds(): Promise<readonly WorkspaceId[]> {
    return [...this.items.keys()].sort();
  }

  async listUnlinkedIds(): Promise<readonly WorkspaceId[]> {
    return [...this.items.values()]
      .filter((workspace) => workspace.organizationId === undefined)
      .map((workspace) => workspace.id)
      .sort();
  }
}

class StubWorkspaceMemberships implements WorkspaceMembershipRepository {
  async save() {}
  async findById() {
    return null;
  }
  async findByWorkspaceAndUser(workspaceId: WorkspaceId, userId: UserId) {
    return workspaceId === WORKSPACE
      ? ({
          id: `wm-${userId}`,
          workspaceId,
          userId,
          role: HUMAN_WORKSPACE_ROLES.DEVELOPER,
          createdAt: NOW,
        } as never)
      : null;
  }
  async countByWorkspaceAndRole() {
    return 1;
  }
  async deleteById() {}
  async listByUserId() {
    return [];
  }
  async listByWorkspaceId() {
    return [];
  }
}

class EmptyOfficeRepository implements OfficeRepository {
  async saveOfficeWorker() {}
  async findOfficeWorkerById() {
    return null;
  }
  async findOfficeWorkerByWorkspaceAndId() {
    return null;
  }
  async listOfficeWorkersByWorkspace() {
    return [];
  }
  async updateOfficeWorker() {
    return null;
  }
  async saveRole() {}
  async findRoleById() {
    return null;
  }
  async findRoleByWorkspaceAndId() {
    return null;
  }
  async listRolesByWorkspace() {
    return [];
  }
  async updateRole() {
    return null;
  }
  async saveTeam() {}
  async findTeamById() {
    return null;
  }
  async findTeamByWorkspaceAndId() {
    return null;
  }
  async listTeamsByWorkspace() {
    return [];
  }
  async updateTeam() {
    return null;
  }
  async addTeamMembership() {}
  async findTeamMembership() {
    return null;
  }
  async listTeamMembershipsByTeam() {
    return [];
  }
  async saveGoal() {}
  async findGoalById() {
    return null;
  }
  async findGoalByWorkspaceAndId() {
    return null;
  }
  async listGoalsByWorkspace() {
    return [];
  }
  async updateGoal() {
    return null;
  }
  async saveAssignment() {}
  async findAssignmentById() {
    return null;
  }
  async findAssignmentByWorkspaceAndId() {
    return null;
  }
  async listAssignmentsByWorkspace() {
    return [];
  }
  async updateAssignment() {
    return null;
  }
  async transitionAssignment(): Promise<Assignment> {
    throw new Error("not implemented");
  }
}

function humanScope(userId: UserId): ControlPlaneScope {
  return {
    principal: {
      authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
      userId,
      sessionId: `sess-${userId}`,
      workspaceId: WORKSPACE,
      humanRole: HUMAN_WORKSPACE_ROLES.DEVELOPER,
    },
  };
}

describe("OfficeCollaborationApplication", () => {
  it("requires human sessions for writes and keeps independent read state", async () => {
    const workspaces = new InMemoryWorkspaceRepository();
    await workspaces.save(
      Workspace.create({ id: WORKSPACE, name: "Office", createdAt: NOW }),
    );

    let idCounter = 0;
    const app = createOfficeCollaborationApplication({
      collaboration: new InMemoryCollaborationRepository(),
      office: new EmptyOfficeRepository(),
      workspaces,
      workspaceMemberships: new StubWorkspaceMemberships(),
      clock: { now: () => NOW },
      ids: {
        createId: () => {
          idCounter += 1;
          return `id-${String(idCounter)}`;
        },
      },
    });

    await expect(
      app.listInbox.execute(
        {
          principal: {
            authenticationMethod: AUTHENTICATION_METHODS.API_KEY,
            subjectId: "ak-1" as never,
            workspaceId: WORKSPACE,
            role: COMMUNITY_EDITION_ROLES.OPERATOR,
          },
        },
        { limit: 10 },
      ),
    ).rejects.toBeInstanceOf(HumanPrincipalRequiredError);

    const thread = await app.createOfficeThread.execute(humanScope(USER_A), {
      title: "General",
    });

    const first = await app.appendOfficeMessage.execute(humanScope(USER_A), {
      threadId: thread.id,
      body: "Hello team",
    });

    await app.appendOfficeMessage.execute(humanScope(USER_B), {
      threadId: thread.id,
      body: "Reply",
      parentMessageId: first.id,
    });

    const history = await app.listOfficeMessages.execute(
      humanScope(USER_B),
      thread.id,
      { limit: 10 },
    );
    expect(history.messages.map((message) => message.sequence)).toEqual([1, 2]);

    const inboxBefore = await app.listInbox.execute(humanScope(USER_B), {
      limit: 10,
    });
    expect(inboxBefore.items.some((item) => item.messageId === first.id)).toBe(
      true,
    );

    await app.updateInboxReadState.execute(humanScope(USER_B), {
      threadId: thread.id,
      lastReadSequence: 2,
    });

    const inboxAfter = await app.listInbox.execute(humanScope(USER_B), {
      limit: 10,
    });
    expect(inboxAfter.items).toHaveLength(0);

    await expect(
      app.updateInboxReadState.execute(humanScope(USER_B), {
        threadId: thread.id,
        lastReadSequence: 0,
      }),
    ).rejects.toThrow();
  });
});
