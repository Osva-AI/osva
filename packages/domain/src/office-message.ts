import type {
  OfficeMessageAuthorType,
  OfficeMessageId,
  OfficeMessageMentionV1,
  OfficeMessageReferenceV1,
  OfficeThreadId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  OFFICE_MESSAGE_AUTHOR_TYPES,
  OFFICE_MESSAGE_BODY_MAX_LENGTH,
} from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireBoundedNonEmptyString } from "./internals.js";

export interface OfficeMessageProps {
  readonly id: OfficeMessageId;
  readonly workspaceId: WorkspaceId;
  readonly threadId: OfficeThreadId;
  readonly sequence: number;
  readonly authorType: OfficeMessageAuthorType;
  readonly authorUserId: UserId | undefined;
  readonly body: string;
  readonly parentMessageId: OfficeMessageId | undefined;
  readonly mentions: readonly OfficeMessageMentionV1[];
  readonly references: readonly OfficeMessageReferenceV1[];
  readonly idempotencyKey: string | undefined;
  readonly createdAt: Date;
}

export interface CreateHumanOfficeMessageProps {
  readonly id: OfficeMessageId;
  readonly workspaceId: WorkspaceId;
  readonly threadId: OfficeThreadId;
  readonly sequence: number;
  readonly authorUserId: UserId;
  readonly body: string;
  readonly parentMessageId?: OfficeMessageId;
  readonly mentions?: readonly OfficeMessageMentionV1[];
  readonly references?: readonly OfficeMessageReferenceV1[];
  readonly idempotencyKey?: string;
  readonly now: Date;
}

export class OfficeMessage {
  readonly id: OfficeMessageId;
  readonly workspaceId: WorkspaceId;
  readonly threadId: OfficeThreadId;
  readonly sequence: number;
  readonly authorType: OfficeMessageAuthorType;
  readonly authorUserId: UserId | undefined;
  readonly body: string;
  readonly parentMessageId: OfficeMessageId | undefined;
  readonly mentions: readonly OfficeMessageMentionV1[];
  readonly references: readonly OfficeMessageReferenceV1[];
  readonly idempotencyKey: string | undefined;
  readonly createdAt: Date;

  private constructor(props: OfficeMessageProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.threadId = props.threadId;
    this.sequence = props.sequence;
    this.authorType = props.authorType;
    this.authorUserId = props.authorUserId;
    this.body = props.body;
    this.parentMessageId = props.parentMessageId;
    this.mentions = props.mentions;
    this.references = props.references;
    this.idempotencyKey = props.idempotencyKey;
    this.createdAt = props.createdAt;
  }

  static createHuman(props: CreateHumanOfficeMessageProps): OfficeMessage {
    if (props.sequence < 1) {
      throw new DomainInvariantError(
        "OfficeMessage.sequence must be positive.",
      );
    }

    return new OfficeMessage({
      id: props.id,
      workspaceId: props.workspaceId,
      threadId: props.threadId,
      sequence: props.sequence,
      authorType: OFFICE_MESSAGE_AUTHOR_TYPES[0],
      authorUserId: props.authorUserId,
      body: requireBoundedNonEmptyString(
        props.body,
        "OfficeMessage.body",
        OFFICE_MESSAGE_BODY_MAX_LENGTH,
      ),
      parentMessageId: props.parentMessageId,
      mentions: props.mentions ?? [],
      references: props.references ?? [],
      idempotencyKey: props.idempotencyKey,
      createdAt: copyInstant(props.now),
    });
  }

  static rehydrate(props: OfficeMessageProps): OfficeMessage {
    return new OfficeMessage({
      ...props,
      createdAt: copyInstant(props.createdAt),
    });
  }
}
