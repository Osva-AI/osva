import type {
  EvaluationRunId,
  EvaluationRunState,
  EvaluationRunTargetType,
  EvaluationSuiteVersionId,
  WorkspaceId,
} from "@osva/contracts";
import { EVALUATION_RUN_TARGET_TYPES } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";
import {
  assertLegalEvaluationRunTransition,
  isEvaluationRunState,
} from "./evaluation-run-state-machine.js";

export interface EvaluationRunCreateProps {
  readonly id: EvaluationRunId;
  readonly workspaceId: WorkspaceId;
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly targetType: EvaluationRunTargetType;
  readonly targetVersionId: string;
  readonly createdAt: Date;
}

export interface EvaluationRunRehydrateProps {
  readonly id: EvaluationRunId;
  readonly workspaceId: WorkspaceId;
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly targetType: EvaluationRunTargetType;
  readonly targetVersionId: string;
  readonly status: EvaluationRunState;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly cancelledAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class EvaluationRun {
  readonly id: EvaluationRunId;
  readonly workspaceId: WorkspaceId;
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly targetType: EvaluationRunTargetType;
  readonly targetVersionId: string;
  readonly status: EvaluationRunState;
  readonly startedAt: Date | undefined;
  readonly completedAt: Date | undefined;
  readonly cancelledAt: Date | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: {
    readonly id: EvaluationRunId;
    readonly workspaceId: WorkspaceId;
    readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
    readonly targetType: EvaluationRunTargetType;
    readonly targetVersionId: string;
    readonly status: EvaluationRunState;
    readonly startedAt: Date | undefined;
    readonly completedAt: Date | undefined;
    readonly cancelledAt: Date | undefined;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.evaluationSuiteVersionId = props.evaluationSuiteVersionId;
    this.targetType = props.targetType;
    this.targetVersionId = props.targetVersionId;
    this.status = props.status;
    this.startedAt = props.startedAt;
    this.completedAt = props.completedAt;
    this.cancelledAt = props.cancelledAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: EvaluationRunCreateProps): EvaluationRun {
    return EvaluationRun.instantiate({
      id: props.id,
      workspaceId: props.workspaceId,
      evaluationSuiteVersionId: props.evaluationSuiteVersionId,
      targetType: props.targetType,
      targetVersionId: props.targetVersionId,
      status: "PENDING",
      startedAt: undefined,
      completedAt: undefined,
      cancelledAt: undefined,
      createdAt: props.createdAt,
      updatedAt: props.createdAt,
    });
  }

  static rehydrate(props: EvaluationRunRehydrateProps): EvaluationRun {
    return EvaluationRun.instantiate({
      id: props.id,
      workspaceId: props.workspaceId,
      evaluationSuiteVersionId: props.evaluationSuiteVersionId,
      targetType: props.targetType,
      targetVersionId: props.targetVersionId,
      status: props.status,
      startedAt: props.startedAt,
      completedAt: props.completedAt,
      cancelledAt: props.cancelledAt,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    });
  }

  transitionTo(
    nextStatus: EvaluationRunState,
    timestamps: {
      readonly updatedAt: Date;
      readonly startedAt?: Date;
      readonly completedAt?: Date;
      readonly cancelledAt?: Date;
    },
  ): EvaluationRun {
    assertLegalEvaluationRunTransition(this.status, nextStatus);

    return EvaluationRun.instantiate({
      id: this.id,
      workspaceId: this.workspaceId,
      evaluationSuiteVersionId: this.evaluationSuiteVersionId,
      targetType: this.targetType,
      targetVersionId: this.targetVersionId,
      status: nextStatus,
      startedAt: timestamps.startedAt ?? this.startedAt,
      completedAt: timestamps.completedAt ?? this.completedAt,
      cancelledAt: timestamps.cancelledAt ?? this.cancelledAt,
      createdAt: this.createdAt,
      updatedAt: copyInstant(timestamps.updatedAt),
    });
  }

  private static instantiate(props: {
    readonly id: EvaluationRunId;
    readonly workspaceId: WorkspaceId;
    readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
    readonly targetType: EvaluationRunTargetType;
    readonly targetVersionId: string;
    readonly status: EvaluationRunState;
    readonly startedAt: Date | undefined;
    readonly completedAt: Date | undefined;
    readonly cancelledAt: Date | undefined;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }): EvaluationRun {
    if (!props.id) {
      throw new DomainInvariantError("EvaluationRun.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("EvaluationRun.workspaceId is required.");
    }

    if (!props.evaluationSuiteVersionId) {
      throw new DomainInvariantError(
        "EvaluationRun.evaluationSuiteVersionId is required.",
      );
    }

    if (!isEvaluationRunTargetType(props.targetType)) {
      throw new DomainInvariantError(
        "EvaluationRun.targetType must be a supported target type.",
      );
    }

    if (!isEvaluationRunState(props.status)) {
      throw new DomainInvariantError(
        "EvaluationRun.status must be a supported evaluation run state.",
      );
    }

    return Object.freeze(
      new EvaluationRun({
        id: props.id,
        workspaceId: props.workspaceId,
        evaluationSuiteVersionId: props.evaluationSuiteVersionId,
        targetType: props.targetType,
        targetVersionId: requireNonEmptyString(
          props.targetVersionId,
          "EvaluationRun.targetVersionId",
        ),
        status: props.status,
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
        createdAt: copyInstant(props.createdAt),
        updatedAt: copyInstant(props.updatedAt),
      }),
    );
  }
}

function isEvaluationRunTargetType(
  value: string,
): value is EvaluationRunTargetType {
  return (EVALUATION_RUN_TARGET_TYPES as readonly string[]).includes(value);
}
