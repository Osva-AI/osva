import type {
  GoalId,
  OfficeThreadId,
  OfficeThreadType,
  TeamId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  OFFICE_THREAD_TYPES,
  OFFICE_THREAD_TITLE_MAX_LENGTH,
} from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireBoundedNonEmptyString } from "./internals.js";

export interface OfficeThreadProps {
  readonly id: OfficeThreadId;
  readonly workspaceId: WorkspaceId;
  readonly title: string;
  readonly type: OfficeThreadType;
  readonly teamId: TeamId | undefined;
  readonly goalId: GoalId | undefined;
  readonly createdByUserId: UserId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly latestMessageSequence: number;
}

export interface CreateOfficeThreadProps {
  readonly id: OfficeThreadId;
  readonly workspaceId: WorkspaceId;
  readonly title: string;
  readonly type?: OfficeThreadType;
  readonly teamId?: TeamId;
  readonly goalId?: GoalId;
  readonly createdByUserId: UserId;
  readonly now: Date;
}

export class OfficeThread {
  readonly id: OfficeThreadId;
  readonly workspaceId: WorkspaceId;
  readonly title: string;
  readonly type: OfficeThreadType;
  readonly teamId: TeamId | undefined;
  readonly goalId: GoalId | undefined;
  readonly createdByUserId: UserId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly latestMessageSequence: number;

  private constructor(props: OfficeThreadProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.title = props.title;
    this.type = props.type;
    this.teamId = props.teamId;
    this.goalId = props.goalId;
    this.createdByUserId = props.createdByUserId;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.latestMessageSequence = props.latestMessageSequence;
  }

  static create(props: CreateOfficeThreadProps): OfficeThread {
    const type = props.type ?? OFFICE_THREAD_TYPES[0];
    if (!OFFICE_THREAD_TYPES.includes(type)) {
      throw new DomainInvariantError(
        `Unsupported office thread type '${type}'.`,
      );
    }

    const now = copyInstant(props.now);
    return new OfficeThread({
      id: props.id,
      workspaceId: props.workspaceId,
      title: requireBoundedNonEmptyString(
        props.title,
        "OfficeThread.title",
        OFFICE_THREAD_TITLE_MAX_LENGTH,
      ),
      type,
      teamId: props.teamId,
      goalId: props.goalId,
      createdByUserId: props.createdByUserId,
      createdAt: now,
      updatedAt: now,
      latestMessageSequence: 0,
    });
  }

  static rehydrate(props: OfficeThreadProps): OfficeThread {
    return new OfficeThread({
      ...props,
      createdAt: copyInstant(props.createdAt),
      updatedAt: copyInstant(props.updatedAt),
    });
  }

  withAppendedMessage(props: {
    readonly now: Date;
    readonly latestMessageSequence: number;
  }): OfficeThread {
    if (props.latestMessageSequence <= this.latestMessageSequence) {
      throw new DomainInvariantError(
        "OfficeThread.latestMessageSequence must increase when appending messages.",
      );
    }

    return new OfficeThread({
      ...this,
      updatedAt: copyInstant(props.now),
      latestMessageSequence: props.latestMessageSequence,
    });
  }
}
