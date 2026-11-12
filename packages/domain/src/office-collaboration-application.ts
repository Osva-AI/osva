import type {
  AssignmentId,
  GoalId,
  OfficeMessageId,
  OfficeMessageMentionV1,
  OfficeMessageReferenceKind,
  OfficeMessageReferenceV1,
  OfficeThreadId,
  TeamId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  AUTHORIZATION_ACTIONS,
  isHumanSessionRequestPrincipal,
} from "@osva-ai/contracts";

import { InboxItemReadState } from "./inbox-item-read-state.js";
import { InboxReadState } from "./inbox-read-state.js";
import {
  AssignmentNotFoundError,
  GoalNotFoundError,
  HumanPrincipalRequiredError,
  OfficeMessageIdempotencyConflictError,
  OfficeMessageNotFoundError,
  OfficeThreadNotFoundError,
  OfficeWorkerNotFoundError,
  TeamNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import { OfficeMessage } from "./office-message.js";
import { OfficeThread } from "./office-thread.js";
import type { OfficeRepository } from "./ports/office-repository.js";
import type { OfficeCollaborationRepository } from "./ports/office-collaboration-repository.js";
import type { WorkspaceMembershipRepository } from "./ports/workspace-membership-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";
import {
  controlPlaneAuditActor,
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";
import { PermissionDeniedError } from "./security-errors.js";

const OFFICE_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.office };

export interface OfficeCollaborationApplicationClock {
  now(): Date;
}

export interface OfficeCollaborationApplicationIds {
  createId(): string;
}

export interface OfficeCollaborationApplicationDependencies {
  readonly collaboration: OfficeCollaborationRepository;
  readonly office: OfficeRepository;
  readonly workspaces: WorkspaceRepository;
  readonly workspaceMemberships: WorkspaceMembershipRepository;
  readonly clock: OfficeCollaborationApplicationClock;
  readonly ids: OfficeCollaborationApplicationIds;
}

function requireHumanUserId(scope: ControlPlaneScope): UserId {
  if (!isHumanSessionRequestPrincipal(scope.principal)) {
    throw new HumanPrincipalRequiredError();
  }
  return scope.principal.userId;
}

async function assertWorkspaceExists(
  workspaces: WorkspaceRepository,
  workspaceId: WorkspaceId,
): Promise<void> {
  const workspace = await workspaces.findById(workspaceId);
  if (workspace === null) {
    throw new WorkspaceNotFoundError(workspaceId);
  }
}

async function validateReferences(
  deps: OfficeCollaborationApplicationDependencies,
  workspaceId: WorkspaceId,
  references: readonly OfficeMessageReferenceV1[],
): Promise<void> {
  for (const reference of references) {
    await assertReferenceExists(deps, workspaceId, reference);
  }
}

async function assertReferenceExists(
  deps: OfficeCollaborationApplicationDependencies,
  workspaceId: WorkspaceId,
  reference: OfficeMessageReferenceV1,
): Promise<void> {
  const kind = reference.kind;
  const id = reference.id;
  switch (kind) {
    case "ASSIGNMENT": {
      const assignment = await deps.office.findAssignmentByWorkspaceAndId(
        workspaceId,
        id as AssignmentId,
      );
      if (assignment === null) {
        throw new AssignmentNotFoundError(id as AssignmentId);
      }
      return;
    }
    case "GOAL": {
      const goal = await deps.office.findGoalByWorkspaceAndId(
        workspaceId,
        id as GoalId,
      );
      if (goal === null) {
        throw new GoalNotFoundError(id as GoalId);
      }
      return;
    }
    case "RUN":
    case "WORKFLOW_RUN":
    case "ARTIFACT":
    case "APPROVAL_REQUEST":
      return;
    default: {
      const _exhaustive: never = kind satisfies OfficeMessageReferenceKind;
      throw _exhaustive;
    }
  }
}

async function validateMentions(
  deps: OfficeCollaborationApplicationDependencies,
  workspaceId: WorkspaceId,
  mentions: readonly OfficeMessageMentionV1[],
): Promise<void> {
  for (const mention of mentions) {
    if (mention.kind === "HUMAN") {
      const membership = await deps.workspaceMemberships.findByWorkspaceAndUser(
        workspaceId,
        mention.userId,
      );
      if (membership === null) {
        throw new PermissionDeniedError();
      }
      continue;
    }

    const worker = await deps.office.findOfficeWorkerByWorkspaceAndId(
      workspaceId,
      mention.officeWorkerId,
    );
    if (worker === null) {
      throw new OfficeWorkerNotFoundError(mention.officeWorkerId);
    }
  }
}

export interface CreateOfficeThreadCommand {
  readonly title: string;
  readonly type?: OfficeThread["type"];
  readonly teamId?: TeamId;
  readonly goalId?: GoalId;
}

export class CreateOfficeThread {
  constructor(
    private readonly deps: OfficeCollaborationApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    command: CreateOfficeThreadCommand,
  ): Promise<OfficeThread> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      OFFICE_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    await assertWorkspaceExists(this.deps.workspaces, workspaceId);
    const createdByUserId = requireHumanUserId(scope);

    if (command.teamId !== undefined) {
      const team = await this.deps.office.findTeamByWorkspaceAndId(
        workspaceId,
        command.teamId,
      );
      if (team === null) {
        throw new TeamNotFoundError(command.teamId);
      }
    }

    if (command.goalId !== undefined) {
      const goal = await this.deps.office.findGoalByWorkspaceAndId(
        workspaceId,
        command.goalId,
      );
      if (goal === null) {
        throw new GoalNotFoundError(command.goalId);
      }
    }

    const thread = OfficeThread.create({
      id: this.deps.ids.createId() as OfficeThreadId,
      workspaceId,
      title: command.title,
      type: command.type,
      teamId: command.teamId,
      goalId: command.goalId,
      createdByUserId,
      now: this.deps.clock.now(),
    });
    await this.deps.collaboration.saveOfficeThread(thread);
    return thread;
  }
}

export class ListOfficeThreads {
  constructor(
    private readonly deps: OfficeCollaborationApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    query: { readonly limit: number; readonly cursor?: string },
  ): Promise<{
    readonly threads: readonly OfficeThread[];
    readonly unreadByThreadId: Readonly<Record<string, number>>;
    readonly nextCursor?: string;
  }> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      OFFICE_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    await assertWorkspaceExists(this.deps.workspaces, workspaceId);

    const listed = await this.deps.collaboration.listOfficeThreads({
      workspaceId,
      limit: query.limit,
      cursor: query.cursor,
    });

    const viewerUserId = isHumanSessionRequestPrincipal(scope.principal)
      ? scope.principal.userId
      : undefined;
    const unreadByThreadId: Record<string, number> = {};
    if (viewerUserId !== undefined) {
      for (const thread of listed.items) {
        unreadByThreadId[thread.id] =
          await this.deps.collaboration.countUnreadMessagesForUser(
            workspaceId,
            viewerUserId,
            thread.id,
          );
      }
    }

    return {
      threads: listed.items,
      unreadByThreadId,
      nextCursor: listed.nextCursor,
    };
  }
}

export class GetOfficeThread {
  constructor(
    private readonly deps: OfficeCollaborationApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    threadId: OfficeThreadId,
  ): Promise<OfficeThread> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      OFFICE_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const thread =
      await this.deps.collaboration.findOfficeThreadByWorkspaceAndId(
        workspaceId,
        threadId,
      );
    if (thread === null) {
      throw new OfficeThreadNotFoundError(threadId);
    }
    return thread;
  }
}

export interface AppendOfficeMessageCommand {
  readonly threadId: OfficeThreadId;
  readonly body: string;
  readonly parentMessageId?: OfficeMessageId;
  readonly mentions?: readonly OfficeMessageMentionV1[];
  readonly references?: readonly OfficeMessageReferenceV1[];
  readonly idempotencyKey?: string;
}

export class AppendOfficeMessage {
  constructor(
    private readonly deps: OfficeCollaborationApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    command: AppendOfficeMessageCommand,
  ): Promise<OfficeMessage> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      OFFICE_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const authorUserId = requireHumanUserId(scope);
    controlPlaneAuditActor(scope);

    const thread =
      await this.deps.collaboration.findOfficeThreadByWorkspaceAndId(
        workspaceId,
        command.threadId,
      );
    if (thread === null) {
      throw new OfficeThreadNotFoundError(command.threadId);
    }

    if (command.idempotencyKey !== undefined) {
      const existing =
        await this.deps.collaboration.findOfficeMessageByWorkspaceThreadAndIdempotencyKey(
          workspaceId,
          command.threadId,
          command.idempotencyKey,
        );
      if (existing !== null) {
        return existing;
      }
    }

    if (command.parentMessageId !== undefined) {
      const parent =
        await this.deps.collaboration.findOfficeMessageByWorkspaceThreadAndId(
          workspaceId,
          command.threadId,
          command.parentMessageId,
        );
      if (parent === null) {
        throw new OfficeMessageNotFoundError(command.parentMessageId);
      }
    }

    const mentions = command.mentions ?? [];
    const references = command.references ?? [];
    await validateMentions(this.deps, workspaceId, mentions);
    await validateReferences(this.deps, workspaceId, references);

    const now = this.deps.clock.now();
    const nextSequence = thread.latestMessageSequence + 1;
    const message = OfficeMessage.createHuman({
      id: this.deps.ids.createId() as OfficeMessageId,
      workspaceId,
      threadId: command.threadId,
      sequence: nextSequence,
      authorUserId,
      body: command.body,
      parentMessageId: command.parentMessageId,
      mentions,
      references,
      idempotencyKey: command.idempotencyKey,
      now,
    });

    const nextThread = thread.withAppendedMessage({
      now,
      latestMessageSequence: nextSequence,
    });

    try {
      await this.deps.collaboration.appendOfficeMessage({
        message,
        nextThread,
      });
    } catch (error) {
      if (error instanceof OfficeMessageIdempotencyConflictError) {
        const existing =
          await this.deps.collaboration.findOfficeMessageByWorkspaceThreadAndIdempotencyKey(
            workspaceId,
            command.threadId,
            command.idempotencyKey ?? "",
          );
        if (existing !== null) {
          return existing;
        }
      }
      throw error;
    }

    return message;
  }
}

export class ListOfficeMessages {
  constructor(
    private readonly deps: OfficeCollaborationApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    threadId: OfficeThreadId,
    query: { readonly limit: number; readonly cursor?: string },
  ): Promise<{
    readonly messages: readonly OfficeMessage[];
    readonly nextCursor?: string;
  }> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      OFFICE_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const thread =
      await this.deps.collaboration.findOfficeThreadByWorkspaceAndId(
        workspaceId,
        threadId,
      );
    if (thread === null) {
      throw new OfficeThreadNotFoundError(threadId);
    }

    const listed = await this.deps.collaboration.listOfficeMessages({
      workspaceId,
      threadId,
      limit: query.limit,
      cursor: query.cursor,
    });
    return {
      messages: listed.items,
      nextCursor: listed.nextCursor,
    };
  }
}

export type UpdateInboxReadStateCommand =
  | {
      readonly threadId: OfficeThreadId;
      readonly lastReadSequence: number;
    }
  | {
      readonly itemId: string;
    };

export type UpdateInboxReadStateResult = InboxReadState | InboxItemReadState;

export class UpdateInboxReadState {
  constructor(
    private readonly deps: OfficeCollaborationApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    command: UpdateInboxReadStateCommand,
  ): Promise<UpdateInboxReadStateResult> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      OFFICE_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const userId = requireHumanUserId(scope);
    await assertWorkspaceExists(this.deps.workspaces, workspaceId);

    if ("itemId" in command) {
      if (!inboxItemKindIsOperationalKindFromItemId(command.itemId)) {
        throw new PermissionDeniedError();
      }

      const ackable =
        await this.deps.collaboration.isOperationalInboxItemAcknowledgeable(
          workspaceId,
          command.itemId,
        );
      if (!ackable) {
        throw new PermissionDeniedError();
      }

      const now = this.deps.clock.now();
      const next = InboxItemReadState.acknowledge({
        workspaceId,
        userId,
        itemId: command.itemId,
        now,
      });
      await this.deps.collaboration.upsertInboxItemReadState(next);
      return next;
    }

    const thread =
      await this.deps.collaboration.findOfficeThreadByWorkspaceAndId(
        workspaceId,
        command.threadId,
      );
    if (thread === null) {
      throw new OfficeThreadNotFoundError(command.threadId);
    }

    if (command.lastReadSequence > thread.latestMessageSequence) {
      throw new PermissionDeniedError();
    }

    const existing = await this.deps.collaboration.findInboxReadState(
      workspaceId,
      userId,
      command.threadId,
    );
    const now = this.deps.clock.now();
    const next =
      existing === null
        ? InboxReadState.create({
            workspaceId,
            userId,
            threadId: command.threadId,
            lastReadSequence: command.lastReadSequence,
            now,
          })
        : existing.withLastReadSequence({
            lastReadSequence: command.lastReadSequence,
            now,
          });

    await this.deps.collaboration.upsertInboxReadState(next);
    return next;
  }
}

function inboxItemKindIsOperationalKindFromItemId(itemId: string): boolean {
  const prefix = itemId.split(":", 1)[0];
  return (
    prefix === "approval" || prefix === "assignment" || prefix === "deliverable"
  );
}

export class ListInbox {
  constructor(
    private readonly deps: OfficeCollaborationApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    query: { readonly limit: number; readonly cursor?: string },
  ): Promise<{
    readonly items: Awaited<
      ReturnType<OfficeCollaborationRepository["listInboxItems"]>
    >["items"];
    readonly nextCursor?: string;
  }> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      OFFICE_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const userId = requireHumanUserId(scope);
    await assertWorkspaceExists(this.deps.workspaces, workspaceId);

    return this.deps.collaboration.listInboxItems({
      workspaceId,
      userId,
      limit: query.limit,
      cursor: query.cursor,
    });
  }
}

export interface OfficeCollaborationApplication {
  readonly createOfficeThread: CreateOfficeThread;
  readonly listOfficeThreads: ListOfficeThreads;
  readonly getOfficeThread: GetOfficeThread;
  readonly appendOfficeMessage: AppendOfficeMessage;
  readonly listOfficeMessages: ListOfficeMessages;
  readonly updateInboxReadState: UpdateInboxReadState;
  readonly listInbox: ListInbox;
}

export function createOfficeCollaborationApplication(
  deps: OfficeCollaborationApplicationDependencies,
): OfficeCollaborationApplication {
  return {
    createOfficeThread: new CreateOfficeThread(deps),
    listOfficeThreads: new ListOfficeThreads(deps),
    getOfficeThread: new GetOfficeThread(deps),
    appendOfficeMessage: new AppendOfficeMessage(deps),
    listOfficeMessages: new ListOfficeMessages(deps),
    updateInboxReadState: new UpdateInboxReadState(deps),
    listInbox: new ListInbox(deps),
  };
}
