import type {
  RunId,
  WorkflowNodeRunId,
  WorkflowNodeRunState,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  copyInstant,
  copyJsonValue,
  freezeClone,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./internals.js";
import {
  assertLegalWorkflowNodeRunTransition,
  isWorkflowNodeRunState,
} from "./workflow-node-run-state-machine.js";
import type { WorkflowRunError } from "./workflow-run.js";

export interface WorkflowNodeRunCreateProps {
  readonly id: WorkflowNodeRunId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeKey: string;
  readonly sequence: number;
  readonly input: unknown;
  readonly createdAt: Date;
}

export interface WorkflowNodeRunRehydrateProps {
  readonly id: WorkflowNodeRunId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeKey: string;
  readonly sequence: number;
  readonly status: WorkflowNodeRunState;
  readonly input: unknown;
  readonly output?: unknown;
  readonly childRunId?: RunId;
  readonly selectedTargetKey?: string;
  readonly error?: WorkflowRunError;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface WorkflowNodeRunProps {
  readonly id: WorkflowNodeRunId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeKey: string;
  readonly sequence: number;
  readonly status: WorkflowNodeRunState;
  readonly input: unknown;
  readonly output: unknown | undefined;
  readonly childRunId: RunId | undefined;
  readonly selectedTargetKey: string | undefined;
  readonly error: WorkflowRunError | undefined;
  readonly startedAt: Date | undefined;
  readonly completedAt: Date | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class WorkflowNodeRun {
  readonly id: WorkflowNodeRunId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeKey: string;
  readonly sequence: number;
  readonly status: WorkflowNodeRunState;
  readonly input: unknown;
  readonly output: unknown | undefined;
  readonly childRunId: RunId | undefined;
  readonly selectedTargetKey: string | undefined;
  readonly error: WorkflowRunError | undefined;
  readonly startedAt: Date | undefined;
  readonly completedAt: Date | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: WorkflowNodeRunProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.workflowRunId = props.workflowRunId;
    this.workflowNodeKey = props.workflowNodeKey;
    this.sequence = props.sequence;
    this.status = props.status;
    this.input = props.input;
    this.output = props.output;
    this.childRunId = props.childRunId;
    this.selectedTargetKey = props.selectedTargetKey;
    this.error = props.error;
    this.startedAt = props.startedAt;
    this.completedAt = props.completedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: WorkflowNodeRunCreateProps): WorkflowNodeRun {
    return WorkflowNodeRun.instantiate({
      id: props.id,
      workspaceId: props.workspaceId,
      workflowRunId: props.workflowRunId,
      workflowNodeKey: props.workflowNodeKey,
      sequence: props.sequence,
      status: "PENDING",
      input: props.input,
      output: undefined,
      childRunId: undefined,
      selectedTargetKey: undefined,
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
      createdAt: props.createdAt,
      updatedAt: props.createdAt,
    });
  }

  static createSkipped(props: WorkflowNodeRunCreateProps): WorkflowNodeRun {
    return WorkflowNodeRun.instantiate({
      id: props.id,
      workspaceId: props.workspaceId,
      workflowRunId: props.workflowRunId,
      workflowNodeKey: props.workflowNodeKey,
      sequence: props.sequence,
      status: "SKIPPED",
      input: props.input,
      output: undefined,
      childRunId: undefined,
      selectedTargetKey: undefined,
      error: undefined,
      startedAt: undefined,
      completedAt: props.createdAt,
      createdAt: props.createdAt,
      updatedAt: props.createdAt,
    });
  }

  static rehydrate(props: WorkflowNodeRunRehydrateProps): WorkflowNodeRun {
    return WorkflowNodeRun.instantiate({
      id: props.id,
      workspaceId: props.workspaceId,
      workflowRunId: props.workflowRunId,
      workflowNodeKey: props.workflowNodeKey,
      sequence: props.sequence,
      status: props.status,
      input: props.input,
      output: props.output,
      childRunId: props.childRunId,
      selectedTargetKey: props.selectedTargetKey,
      error: props.error,
      startedAt: props.startedAt,
      completedAt: props.completedAt,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    });
  }

  withChildRunId(childRunId: RunId, now: Date): WorkflowNodeRun {
    if (this.childRunId !== undefined && this.childRunId !== childRunId) {
      throw new DomainInvariantError(
        `WorkflowNodeRun '${this.id}' already has child Run '${this.childRunId}'.`,
      );
    }

    if (this.childRunId === childRunId) {
      return this;
    }

    return WorkflowNodeRun.instantiate({
      ...this.copyProps(),
      childRunId,
      updatedAt: now,
    });
  }

  markRunning(now: Date): WorkflowNodeRun {
    return this.transitionTo("RUNNING", {
      now,
      startedAt: this.startedAt ?? now,
    });
  }

  markWaitingForApproval(now: Date): WorkflowNodeRun {
    return this.transitionTo("WAITING_FOR_APPROVAL", {
      now,
      startedAt: this.startedAt ?? now,
    });
  }

  markSucceeded(
    now: Date,
    output: unknown,
    selectedTargetKey?: string,
  ): WorkflowNodeRun {
    if (
      this.selectedTargetKey !== undefined &&
      selectedTargetKey !== undefined &&
      this.selectedTargetKey !== selectedTargetKey
    ) {
      throw new DomainInvariantError(
        `WorkflowNodeRun '${this.id}' already selected '${this.selectedTargetKey}'.`,
      );
    }

    return this.transitionTo("SUCCEEDED", {
      now,
      output,
      selectedTargetKey: selectedTargetKey ?? this.selectedTargetKey,
      completedAt: now,
      startedAt: this.startedAt ?? now,
    });
  }

  markFailed(now: Date, error: WorkflowRunError): WorkflowNodeRun {
    return this.transitionTo("FAILED", {
      now,
      error,
      completedAt: now,
      startedAt: this.startedAt ?? now,
    });
  }

  markSkipped(now: Date): WorkflowNodeRun {
    return this.transitionTo("SKIPPED", {
      now,
      completedAt: now,
    });
  }

  private copyProps(): WorkflowNodeRunProps {
    return {
      id: this.id,
      workspaceId: this.workspaceId,
      workflowRunId: this.workflowRunId,
      workflowNodeKey: this.workflowNodeKey,
      sequence: this.sequence,
      status: this.status,
      input: this.input,
      output: this.output,
      childRunId: this.childRunId,
      selectedTargetKey: this.selectedTargetKey,
      error: this.error,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  private transitionTo(
    target: WorkflowNodeRunState,
    options: {
      readonly now: Date;
      readonly output?: unknown;
      readonly error?: WorkflowRunError;
      readonly selectedTargetKey?: string;
      readonly startedAt?: Date;
      readonly completedAt?: Date;
    },
  ): WorkflowNodeRun {
    assertLegalWorkflowNodeRunTransition(this.status, target);

    return WorkflowNodeRun.instantiate({
      ...this.copyProps(),
      status: target,
      output: options.output !== undefined ? options.output : this.output,
      selectedTargetKey: options.selectedTargetKey ?? this.selectedTargetKey,
      error: options.error ?? this.error,
      startedAt: options.startedAt ?? this.startedAt,
      completedAt: options.completedAt ?? this.completedAt,
      updatedAt: options.now,
    });
  }

  private static instantiate(props: WorkflowNodeRunProps): WorkflowNodeRun {
    if (!props.id) {
      throw new DomainInvariantError("WorkflowNodeRun.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError(
        "WorkflowNodeRun.workspaceId is required.",
      );
    }

    if (!props.workflowRunId) {
      throw new DomainInvariantError(
        "WorkflowNodeRun.workflowRunId is required.",
      );
    }

    if (!isWorkflowNodeRunState(props.status)) {
      throw new DomainInvariantError(
        `Invalid workflow node run status: ${props.status}`,
      );
    }

    if (props.childRunId !== undefined && !props.childRunId) {
      throw new DomainInvariantError(
        "WorkflowNodeRun.childRunId must be a non-empty string when present.",
      );
    }

    if (
      props.selectedTargetKey !== undefined &&
      props.selectedTargetKey.trim().length === 0
    ) {
      throw new DomainInvariantError(
        "WorkflowNodeRun.selectedTargetKey must be a non-empty string when present.",
      );
    }

    const createdAt = copyInstant(props.createdAt);
    const updatedAt = copyInstant(props.updatedAt);
    if (updatedAt.getTime() < createdAt.getTime()) {
      throw new DomainInvariantError(
        "WorkflowNodeRun.updatedAt cannot be earlier than createdAt.",
      );
    }

    const nodeRun = new WorkflowNodeRun({
      id: props.id,
      workspaceId: props.workspaceId,
      workflowRunId: props.workflowRunId,
      workflowNodeKey: requireNonEmptyString(
        props.workflowNodeKey,
        "WorkflowNodeRun.workflowNodeKey",
      ),
      sequence: requirePositiveInteger(
        props.sequence,
        "WorkflowNodeRun.sequence",
      ),
      status: props.status,
      input: copyJsonValue(props.input, "WorkflowNodeRun.input"),
      output:
        props.output === undefined
          ? undefined
          : copyJsonValue(props.output, "WorkflowNodeRun.output"),
      childRunId: props.childRunId,
      selectedTargetKey:
        props.selectedTargetKey === undefined
          ? undefined
          : requireNonEmptyString(
              props.selectedTargetKey,
              "WorkflowNodeRun.selectedTargetKey",
            ),
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
    Object.freeze(nodeRun);
    return nodeRun;
  }
}
