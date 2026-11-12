import type { OfficeThreadId, UserId, WorkspaceId } from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant } from "./internals.js";

export interface InboxReadStateProps {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly threadId: OfficeThreadId;
  readonly lastReadSequence: number;
  readonly updatedAt: Date;
}

export class InboxReadState {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly threadId: OfficeThreadId;
  readonly lastReadSequence: number;
  readonly updatedAt: Date;

  private constructor(props: InboxReadStateProps) {
    this.workspaceId = props.workspaceId;
    this.userId = props.userId;
    this.threadId = props.threadId;
    this.lastReadSequence = props.lastReadSequence;
    this.updatedAt = props.updatedAt;
  }

  static create(props: {
    readonly workspaceId: WorkspaceId;
    readonly userId: UserId;
    readonly threadId: OfficeThreadId;
    readonly lastReadSequence: number;
    readonly now: Date;
  }): InboxReadState {
    if (props.lastReadSequence < 0) {
      throw new DomainInvariantError(
        "InboxReadState.lastReadSequence must be non-negative.",
      );
    }

    return new InboxReadState({
      workspaceId: props.workspaceId,
      userId: props.userId,
      threadId: props.threadId,
      lastReadSequence: props.lastReadSequence,
      updatedAt: copyInstant(props.now),
    });
  }

  static rehydrate(props: InboxReadStateProps): InboxReadState {
    return new InboxReadState({
      ...props,
      updatedAt: copyInstant(props.updatedAt),
    });
  }

  withLastReadSequence(props: {
    readonly lastReadSequence: number;
    readonly now: Date;
  }): InboxReadState {
    if (props.lastReadSequence < this.lastReadSequence) {
      throw new DomainInvariantError(
        "InboxReadState.lastReadSequence cannot move backwards.",
      );
    }

    return new InboxReadState({
      ...this,
      lastReadSequence: props.lastReadSequence,
      updatedAt: copyInstant(props.now),
    });
  }
}
