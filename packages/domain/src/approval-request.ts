import type {
  ApprovalRequestId,
  ApprovalRequestState,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import { APPROVAL_DECISION_COMMENT_MAX_LENGTH } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireBoundedNonEmptyString } from "./internals.js";
import {
  assertLegalApprovalRequestTransition,
  isApprovalRequestState,
} from "./approval-request-state-machine.js";

export interface ApprovalRequestCreateProps {
  readonly id: ApprovalRequestId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly createdAt: Date;
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
      id: this.id,
      workspaceId: this.workspaceId,
      workflowRunId: this.workflowRunId,
      workflowNodeRunId: this.workflowNodeRunId,
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
      createdAt: this.createdAt,
      updatedAt: now,
    });
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
    });
    Object.freeze(request);
    return request;
  }
}
