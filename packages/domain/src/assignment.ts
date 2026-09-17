import type {
  AssignmentId,
  AssignmentState,
  AssignmentTargetType,
  GoalId,
  JsonValue,
  OfficeWorkerId,
  RunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import { isCanonicalJsonValue } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  assertLegalAssignmentTransition,
  isTerminalAssignmentState,
} from "./assignment-state-machine.js";
import {
  copyCanonicalJsonValue,
  copyInstant,
  requireNonEmptyString,
} from "./internals.js";

export interface AssignmentProps {
  readonly id: AssignmentId;
  readonly workspaceId: WorkspaceId;
  readonly goalId?: GoalId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly title: string;
  readonly description?: string;
  readonly targetType: AssignmentTargetType;
  readonly targetVersionId: string;
  readonly input: JsonValue;
  readonly status: AssignmentState;
  readonly runId?: RunId;
  readonly workflowRunId?: WorkflowRunId;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly cancelledAt?: Date;
}

export interface CreateAssignmentProps {
  readonly id: AssignmentId;
  readonly workspaceId: WorkspaceId;
  readonly goalId?: GoalId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly title: string;
  readonly description?: string;
  readonly targetType: AssignmentTargetType;
  readonly targetVersionId: string;
  readonly input: JsonValue;
  readonly now: Date;
}

export interface UpdateAssignmentProps {
  readonly title?: string;
  readonly description?: string;
  readonly goalId?: GoalId | null;
  readonly now: Date;
}

export interface LaunchAssignmentProps {
  readonly runId?: RunId;
  readonly workflowRunId?: WorkflowRunId;
  readonly now: Date;
}

export class Assignment {
  readonly id: AssignmentId;
  readonly workspaceId: WorkspaceId;
  readonly goalId: GoalId | undefined;
  readonly officeWorkerId: OfficeWorkerId;
  readonly title: string;
  readonly description: string | undefined;
  readonly targetType: AssignmentTargetType;
  readonly targetVersionId: string;
  readonly input: JsonValue;
  readonly status: AssignmentState;
  readonly runId: RunId | undefined;
  readonly workflowRunId: WorkflowRunId | undefined;
  readonly createdAt: Date;
  readonly startedAt: Date | undefined;
  readonly completedAt: Date | undefined;
  readonly cancelledAt: Date | undefined;

  private constructor(props: AssignmentProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.goalId = props.goalId;
    this.officeWorkerId = props.officeWorkerId;
    this.title = props.title;
    this.description = props.description;
    this.targetType = props.targetType;
    this.targetVersionId = props.targetVersionId;
    this.input = props.input;
    this.status = props.status;
    this.runId = props.runId;
    this.workflowRunId = props.workflowRunId;
    this.createdAt = props.createdAt;
    this.startedAt = props.startedAt;
    this.completedAt = props.completedAt;
    this.cancelledAt = props.cancelledAt;
  }

  static create(props: CreateAssignmentProps): Assignment {
    if (!props.id) {
      throw new DomainInvariantError("Assignment.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("Assignment.workspaceId is required.");
    }

    if (!props.officeWorkerId) {
      throw new DomainInvariantError("Assignment.officeWorkerId is required.");
    }

    assertTargetVersionId(props.targetType, props.targetVersionId);

    const now = copyInstant(props.now);
    const input = copyCanonicalJsonValue(
      props.input,
      "Assignment.input",
    ) as JsonValue;

    return Object.freeze(
      new Assignment({
        id: props.id,
        workspaceId: props.workspaceId,
        goalId: props.goalId,
        officeWorkerId: props.officeWorkerId,
        title: requireNonEmptyString(props.title, "Assignment.title"),
        description:
          props.description === undefined
            ? undefined
            : requireNonEmptyString(
                props.description,
                "Assignment.description",
              ),
        targetType: props.targetType,
        targetVersionId: props.targetVersionId,
        input,
        status: "PENDING",
        runId: undefined,
        workflowRunId: undefined,
        createdAt: now,
        startedAt: undefined,
        completedAt: undefined,
        cancelledAt: undefined,
      }),
    );
  }

  static rehydrate(props: AssignmentProps): Assignment {
    if (!isCanonicalJsonValue(props.input)) {
      throw new DomainInvariantError(
        "Assignment.input must be JSON-compatible.",
      );
    }

    return Object.freeze(
      new Assignment({
        id: props.id,
        workspaceId: props.workspaceId,
        goalId: props.goalId,
        officeWorkerId: props.officeWorkerId,
        title: props.title,
        description: props.description,
        targetType: props.targetType,
        targetVersionId: props.targetVersionId,
        input: props.input,
        status: props.status,
        runId: props.runId,
        workflowRunId: props.workflowRunId,
        createdAt: copyInstant(props.createdAt),
        startedAt:
          props.startedAt === undefined
            ? undefined
            : copyInstant(props.startedAt),
        completedAt:
          props.completedAt === undefined
            ? undefined
            : copyInstant(props.completedAt),
        cancelledAt:
          props.cancelledAt === undefined
            ? undefined
            : copyInstant(props.cancelledAt),
      }),
    );
  }

  get isLaunched(): boolean {
    return this.startedAt !== undefined;
  }

  update(props: UpdateAssignmentProps): Assignment {
    if (this.isLaunched) {
      throw new DomainInvariantError(
        "Assignment metadata cannot be changed after execution has started.",
      );
    }

    const title =
      props.title === undefined
        ? this.title
        : requireNonEmptyString(props.title, "Assignment.title");
    const description =
      props.description === undefined ? this.description : props.description;
    const goalId =
      props.goalId === null
        ? undefined
        : props.goalId === undefined
          ? this.goalId
          : props.goalId;

    return Assignment.rehydrate({
      id: this.id,
      workspaceId: this.workspaceId,
      goalId,
      officeWorkerId: this.officeWorkerId,
      title,
      description:
        description === undefined
          ? undefined
          : requireNonEmptyString(description, "Assignment.description"),
      targetType: this.targetType,
      targetVersionId: this.targetVersionId,
      input: this.input,
      status: this.status,
      runId: this.runId,
      workflowRunId: this.workflowRunId,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      cancelledAt: this.cancelledAt,
    });
  }

  markLaunched(props: LaunchAssignmentProps): Assignment {
    if (this.status !== "PENDING" && this.status !== "RUNNING") {
      throw new DomainInvariantError(
        `Assignment ${this.id} cannot be launched from status ${this.status}.`,
      );
    }

    if (this.targetType === "AGENT_VERSION" && props.runId === undefined) {
      throw new DomainInvariantError(
        "Agent-backed assignments require runId when marking launched.",
      );
    }

    if (
      this.targetType === "WORKFLOW_VERSION" &&
      props.workflowRunId === undefined
    ) {
      throw new DomainInvariantError(
        "Workflow-backed assignments require workflowRunId when marking launched.",
      );
    }

    const now = copyInstant(props.now);
    const nextStatus = this.status === "PENDING" ? "RUNNING" : this.status;
    if (nextStatus !== this.status) {
      assertLegalAssignmentTransition(this.status, nextStatus);
    }

    return Assignment.rehydrate({
      id: this.id,
      workspaceId: this.workspaceId,
      goalId: this.goalId,
      officeWorkerId: this.officeWorkerId,
      title: this.title,
      description: this.description,
      targetType: this.targetType,
      targetVersionId: this.targetVersionId,
      input: this.input,
      status: nextStatus,
      runId: props.runId ?? this.runId,
      workflowRunId: props.workflowRunId ?? this.workflowRunId,
      createdAt: this.createdAt,
      startedAt: this.startedAt ?? now,
      completedAt: this.completedAt,
      cancelledAt: this.cancelledAt,
    });
  }

  transitionTo(
    nextStatus: AssignmentState,
    timestamps: {
      readonly now: Date;
      readonly completedAt?: Date;
      readonly cancelledAt?: Date;
    },
  ): Assignment {
    if (nextStatus === this.status) {
      return this;
    }

    assertLegalAssignmentTransition(this.status, nextStatus);

    return Assignment.rehydrate({
      id: this.id,
      workspaceId: this.workspaceId,
      goalId: this.goalId,
      officeWorkerId: this.officeWorkerId,
      title: this.title,
      description: this.description,
      targetType: this.targetType,
      targetVersionId: this.targetVersionId,
      input: this.input,
      status: nextStatus,
      runId: this.runId,
      workflowRunId: this.workflowRunId,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt:
        nextStatus === "COMPLETED"
          ? (timestamps.completedAt ?? timestamps.now)
          : this.completedAt,
      cancelledAt:
        nextStatus === "CANCELLED"
          ? (timestamps.cancelledAt ?? timestamps.now)
          : this.cancelledAt,
    });
  }

  cancel(now: Date): Assignment {
    if (isTerminalAssignmentState(this.status)) {
      return this;
    }

    return this.transitionTo("CANCELLED", { now, cancelledAt: now });
  }
}

function assertTargetVersionId(
  targetType: AssignmentTargetType,
  targetVersionId: string,
): void {
  if (targetVersionId.length === 0) {
    throw new DomainInvariantError("Assignment.targetVersionId is required.");
  }

  if (targetType !== "AGENT_VERSION" && targetType !== "WORKFLOW_VERSION") {
    throw new DomainInvariantError(
      `Assignment.targetType '${targetType}' is not supported.`,
    );
  }
}
