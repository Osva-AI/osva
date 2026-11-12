import type { UserId, WorkspaceId } from "@osva-ai/contracts";

import { copyInstant } from "./internals.js";

export interface InboxItemReadStateProps {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly itemId: string;
  readonly updatedAt: Date;
}

export class InboxItemReadState {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly itemId: string;
  readonly updatedAt: Date;

  private constructor(props: InboxItemReadStateProps) {
    this.workspaceId = props.workspaceId;
    this.userId = props.userId;
    this.itemId = props.itemId;
    this.updatedAt = props.updatedAt;
  }

  static acknowledge(props: {
    readonly workspaceId: WorkspaceId;
    readonly userId: UserId;
    readonly itemId: string;
    readonly now: Date;
  }): InboxItemReadState {
    return new InboxItemReadState({
      workspaceId: props.workspaceId,
      userId: props.userId,
      itemId: props.itemId,
      updatedAt: copyInstant(props.now),
    });
  }

  static rehydrate(props: InboxItemReadStateProps): InboxItemReadState {
    return new InboxItemReadState({
      ...props,
      updatedAt: copyInstant(props.updatedAt),
    });
  }
}
