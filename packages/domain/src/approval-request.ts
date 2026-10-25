import type {
  ApprovalOperationKind,
  ApprovalRequestId,
  ApprovalRequestState,
  JsonValue,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { APPROVAL_DECISION_COMMENT_MAX_LENGTH } from "@osva-ai/contracts";

import {
  buildWorkflowNodeProgressionBinding,
  digestApprovalOperationBinding,
} from "./approval-operation-binding.js";
import {
  assertLegalApprovalRequestTransition,
  isApprovalRequestState,
} from "./approval-request-state-machine.js";
import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireBoundedNonEmptyString } from "./internals.js";

export interface ApprovalRequestCreateProps {
  readonly id: ApprovalRequestId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly createdAt: Date;
  readonly operationKind?: ApprovalOperationKind;
  readonly operationDigest?: string;
  readonly expiresAt?: Date;
}

export interface ApprovalRequestRehydrateProps {
  readonly id: ApprovalRequestId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly status: ApprovalRequestState;
  readonly decisionComment?: string;
  readonly decidedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly operationKind?: ApprovalOperationKind;
  readonly operationDigest?: string;
  readonly expiresAt?: Date;
}

interface ApprovalRequestProps {
  readonly id: ApprovalRequestId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly status: ApprovalRequestState;
  readonly decisionComment: string | undefined;
  readonly decidedAt: Date | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly operationKind: ApprovalOperationKind | undefined;
  readonly operationDigest: string | undefined;
  readonly expiresAt: Date | undefined;
}

export class ApprovalRequest {
  readonly id: ApprovalRequestId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly status: ApprovalRequestState;
  readonly decisionComment: string | undefined;
  readonly decidedAt: Date | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly operationKind: ApprovalOperationKind | undefined;
  readonly operationDigest: string | undefined;
  readonly expiresAt: Date | undefined;

  private constructor(props: ApprovalRequestProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.workflowRunId = props.workflowRunId;
    this.workflowNodeRunId = props.workflowNodeRunId;
    this.status = props.status;
    this.decisionComment = props.decisionComment;
    this.decidedAt = props.decidedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.operationKind = props.operationKind;
    this.operationDigest = props.operationDigest;
    this.expiresAt = props.expiresAt;
  }

  static create(props: ApprovalRequestCreateProps): ApprovalRequest {
    return ApprovalRequest.instantiate({
      id: props.id,
      workspaceId: props.workspaceId,
      workflowRunId: props.workflowRunId,
      workflowNodeRunId: props.workflowNodeRunId,
      status: "PENDING",
      decisionComment: undefined,
      decidedAt: undefined,
      createdAt: props.createdAt,
      updatedAt: props.createdAt,
      operationKind: props.operationKind,
      operationDigest: props.operationDigest,
      expiresAt: props.expiresAt,
    });
  }

  static createForWorkflowNodeProgression(input: {
    readonly id: ApprovalRequestId;
    readonly workspaceId: WorkspaceId;
    readonly workflowRunId: WorkflowRunId;
    readonly workflowNodeRunId: WorkflowNodeRunId;
    readonly nodeInput: JsonValue;
    readonly createdAt: Date;
    readonly expiresAt?: Date;
  }): ApprovalRequest {
    const binding = buildWorkflowNodeProgressionBinding({
      workspaceId: input.workspaceId,
      workflowRunId: input.workflowRunId,
      workflowNodeRunId: input.workflowNodeRunId,
      nodeInput: input.nodeInput,
    });

    return ApprovalRequest.create({
      id: input.id,
      workspaceId: input.workspaceId,
      workflowRunId: input.workflowRunId,
      workflowNodeRunId: input.workflowNodeRunId,
      createdAt: input.createdAt,
      operationKind: binding.kind,
      operationDigest: digestApprovalOperationBinding(binding),
      expiresAt: input.expiresAt,
    });
  }

  static rehydrate(props: ApprovalRequestRehydrateProps): ApprovalRequest {
    return ApprovalRequest.instantiate({
      id: props.id,
      workspaceId: props.workspaceId,
      workflowRunId: props.workflowRunId,
      workflowNodeRunId: props.workflowNodeRunId,
      status: props.status,
      decisionComment: props.decisionComment,
      decidedAt: props.decidedAt,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      operationKind: props.operationKind,
      operationDigest: props.operationDigest,
      expiresAt: props.expiresAt,
    });
  }

  markApproved(now: Date, comment?: string): ApprovalRequest {
    return this.decide("APPROVED", now, comment);
  }

  markRejected(now: Date, comment?: string): ApprovalRequest {
    return this.decide("REJECTED", now, comment);
  }

  private decide(
    status: "APPROVED" | "REJECTED",
    now: Date,
    comment: string | undefined,
  ): ApprovalRequest {
    assertLegalApprovalRequestTransition(this.status, status);

    return ApprovalRequest.instantiate({
      ...this.toProps(),
      status,
      decisionComment:
        comment === undefined
          ? undefined
          : requireBoundedNonEmptyString(
              comment,
              "ApprovalRequest.decisionComment",
              APPROVAL_DECISION_COMMENT_MAX_LENGTH,
            ),
      decidedAt: now,
      updatedAt: now,
    });
  }

  private toProps(): ApprovalRequestProps {
    return {
      id: this.id,
      workspaceId: this.workspaceId,
      workflowRunId: this.workflowRunId,
      workflowNodeRunId: this.workflowNodeRunId,
      status: this.status,
      decisionComment: this.decisionComment,
      decidedAt: this.decidedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      operationKind: this.operationKind,
      operationDigest: this.operationDigest,
      expiresAt: this.expiresAt,
    };
  }

  private static instantiate(props: ApprovalRequestProps): ApprovalRequest {
    if (!props.id) {
      throw new DomainInvariantError("ApprovalRequest.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError(
        "ApprovalRequest.workspaceId is required.",
      );
    }

    if (!props.workflowRunId) {
      throw new DomainInvariantError(
        "ApprovalRequest.workflowRunId is required.",
      );
    }

    if (!props.workflowNodeRunId) {
      throw new DomainInvariantError(
        "ApprovalRequest.workflowNodeRunId is required.",
      );
    }

    if (
      (props.operationKind === undefined) !==
      (props.operationDigest === undefined)
    ) {
      throw new DomainInvariantError(
        "ApprovalRequest operationKind and operationDigest must be set together.",
      );
    }

    if (!isApprovalRequestState(props.status)) {
      throw new DomainInvariantError(
        `Invalid approval request status: ${props.status}`,
      );
    }

    if (props.status === "PENDING") {
      if (
        props.decidedAt !== undefined ||
        props.decisionComment !== undefined
      ) {
        throw new DomainInvariantError(
          "A PENDING ApprovalRequest cannot record a decision.",
        );
      }
    } else if (props.decidedAt === undefined) {
      throw new DomainInvariantError(
        "A resolved ApprovalRequest must record decidedAt.",
      );
    }

    const createdAt = copyInstant(props.createdAt);
    const updatedAt = copyInstant(props.updatedAt);
    if (updatedAt.getTime() < createdAt.getTime()) {
      throw new DomainInvariantError(
        "ApprovalRequest.updatedAt cannot be earlier than createdAt.",
      );
    }

    const request = new ApprovalRequest({
      id: props.id,
      workspaceId: props.workspaceId,
      workflowRunId: props.workflowRunId,
      workflowNodeRunId: props.workflowNodeRunId,
      status: props.status,
      decisionComment:
        props.decisionComment === undefined
          ? undefined
          : requireBoundedNonEmptyString(
              props.decisionComment,
              "ApprovalRequest.decisionComment",
              APPROVAL_DECISION_COMMENT_MAX_LENGTH,
            ),
      decidedAt:
        props.decidedAt === undefined
          ? undefined
          : copyInstant(props.decidedAt),
      createdAt,
      updatedAt,
      operationKind: props.operationKind,
      operationDigest: props.operationDigest,
      expiresAt:
        props.expiresAt === undefined
          ? undefined
          : copyInstant(props.expiresAt),
    });
    Object.freeze(request);
    return request;
  }
}
