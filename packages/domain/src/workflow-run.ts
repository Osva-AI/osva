import type {
  WorkflowId,
  WorkflowRunId,
  WorkflowRunState,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, copyJsonValue, freezeClone } from "./internals.js";
import {
  assertLegalWorkflowRunTransition,
  isWorkflowRunState,
} from "./workflow-run-state-machine.js";

export interface WorkflowRunError {
  readonly code: string;
  readonly message: string;
}

export interface WorkflowRunCreateProps {
  readonly id: WorkflowRunId;
  readonly workspaceId: WorkspaceId;
  readonly workflowId: WorkflowId;
  readonly workflowVersionId: WorkflowVersionId;
  readonly input: unknown;
  readonly createdAt: Date;
}

export interface WorkflowRunRehydrateProps {
  readonly id: WorkflowRunId;
  readonly workspaceId: WorkspaceId;
  readonly workflowId: WorkflowId;
  readonly workflowVersionId: WorkflowVersionId;
  readonly status: WorkflowRunState;
  readonly input: unknown;
  readonly output?: unknown;
  readonly error?: WorkflowRunError;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class WorkflowRun {
  readonly id: WorkflowRunId;
  readonly workspaceId: WorkspaceId;
  readonly workflowId: WorkflowId;
  readonly workflowVersionId: WorkflowVersionId;
  readonly status: WorkflowRunState;
  readonly input: unknown;
  readonly output: unknown | undefined;
  readonly error: WorkflowRunError | undefined;
  readonly startedAt: Date | undefined;
  readonly completedAt: Date | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: {
    readonly id: WorkflowRunId;
    readonly workspaceId: WorkspaceId;
    readonly workflowId: WorkflowId;
    readonly workflowVersionId: WorkflowVersionId;
    readonly status: WorkflowRunState;
    readonly input: unknown;
    readonly output: unknown | undefined;
    readonly error: WorkflowRunError | undefined;
    readonly startedAt: Date | undefined;
    readonly completedAt: Date | undefined;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.workflowId = props.workflowId;
    this.workflowVersionId = props.workflowVersionId;
    this.status = props.status;
    this.input = props.input;
    this.output = props.output;
    this.error = props.error;
    this.startedAt = props.startedAt;
    this.completedAt = props.completedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: WorkflowRunCreateProps): WorkflowRun {
    return WorkflowRun.instantiate({
      id: props.id,
      workspaceId: props.workspaceId,
      workflowId: props.workflowId,
      workflowVersionId: props.workflowVersionId,
      status: "PENDING",
      input: props.input,
      output: undefined,
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
      createdAt: props.createdAt,
      updatedAt: props.createdAt,
    });
  }

  static rehydrate(props: WorkflowRunRehydrateProps): WorkflowRun {
    return WorkflowRun.instantiate({
      id: props.id,
      workspaceId: props.workspaceId,
      workflowId: props.workflowId,
      workflowVersionId: props.workflowVersionId,
      status: props.status,
      input: props.input,
      output: props.output,
      error: props.error,
      startedAt: props.startedAt,
      completedAt: props.completedAt,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    });
  }

  markRunning(now: Date): WorkflowRun {
    return this.transitionTo("RUNNING", {
      now,
      startedAt: this.startedAt ?? now,
    });
  }

  markWaiting(now: Date): WorkflowRun {
    return this.transitionTo("WAITING", {
      now,
      startedAt: this.startedAt ?? now,
    });
  }

  markCancelled(now: Date): WorkflowRun {
    return this.transitionTo("CANCELLED", {
      now,
      completedAt: now,
      startedAt: this.startedAt ?? now,
    });
  }

  markSucceeded(now: Date, output: unknown): WorkflowRun {
    return this.transitionTo("SUCCEEDED", {
      now,
      output,
      completedAt: now,
      startedAt: this.startedAt ?? now,
    });
  }

  markFailed(now: Date, error: WorkflowRunError): WorkflowRun {
    return this.transitionTo("FAILED", {
      now,
      error,
      completedAt: now,
      startedAt: this.startedAt ?? now,
    });
  }

  private transitionTo(
    target: WorkflowRunState,
    options: {
      readonly now: Date;
      readonly output?: unknown;
      readonly error?: WorkflowRunError;
      readonly startedAt?: Date;
      readonly completedAt?: Date;
    },
  ): WorkflowRun {
    assertLegalWorkflowRunTransition(this.status, target);

    return WorkflowRun.instantiate({
      id: this.id,
      workspaceId: this.workspaceId,
      workflowId: this.workflowId,
      workflowVersionId: this.workflowVersionId,
      status: target,
      input: this.input,
      output: options.output !== undefined ? options.output : this.output,
      error: options.error ?? this.error,
      startedAt: options.startedAt ?? this.startedAt,
      completedAt: options.completedAt ?? this.completedAt,
      createdAt: this.createdAt,
      updatedAt: options.now,
    });
  }

  private static instantiate(props: {
    readonly id: WorkflowRunId;
    readonly workspaceId: WorkspaceId;
    readonly workflowId: WorkflowId;
    readonly workflowVersionId: WorkflowVersionId;
    readonly status: WorkflowRunState;
    readonly input: unknown;
    readonly output: unknown | undefined;
    readonly error: WorkflowRunError | undefined;
    readonly startedAt: Date | undefined;
    readonly completedAt: Date | undefined;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }): WorkflowRun {
    if (!props.id) {
      throw new DomainInvariantError("WorkflowRun.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("WorkflowRun.workspaceId is required.");
    }

    if (!props.workflowId) {
      throw new DomainInvariantError("WorkflowRun.workflowId is required.");
    }

    if (!props.workflowVersionId) {
      throw new DomainInvariantError(
        "WorkflowRun.workflowVersionId is required.",
      );
    }

    if (!isWorkflowRunState(props.status)) {
      throw new DomainInvariantError(
        `Invalid workflow run status: ${props.status}`,
      );
    }

    const createdAt = copyInstant(props.createdAt);
    const updatedAt = copyInstant(props.updatedAt);
    if (updatedAt.getTime() < createdAt.getTime()) {
      throw new DomainInvariantError(
        "WorkflowRun.updatedAt cannot be earlier than createdAt.",
      );
    }

    const workflowRun = new WorkflowRun({
      id: props.id,
      workspaceId: props.workspaceId,
      workflowId: props.workflowId,
      workflowVersionId: props.workflowVersionId,
      status: props.status,
      input: copyJsonValue(props.input, "WorkflowRun.input"),
      output:
        props.output === undefined
          ? undefined
          : copyJsonValue(props.output, "WorkflowRun.output"),
      error: props.error === undefined ? undefined : freezeClone(props.error),
      startedAt:
        props.startedAt === undefined
          ? undefined
          : copyInstant(props.startedAt),
      completedAt:
        props.completedAt === undefined
          ? undefined
          : copyInstant(props.completedAt),
      createdAt,
      updatedAt,
    });
    Object.freeze(workflowRun);
    return workflowRun;
  }
}
