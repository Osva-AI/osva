import type { RunAttemptId, RunId, RunStepId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  copyInstant,
  freezeRecord,
  requireNonEmptyString,
} from "./internals.js";

export type RunStepMetadata = Readonly<Record<string, unknown>>;

export interface RunStepProps {
  readonly id: RunStepId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly type: string;
  readonly name: string;
  readonly startedAt: Date;
  readonly completedAt?: Date;
  readonly metadata?: RunStepMetadata;
}

export class RunStep {
  readonly id: RunStepId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly type: string;
  readonly name: string;
  readonly startedAt: Date;
  readonly completedAt: Date | undefined;
  readonly metadata: RunStepMetadata | undefined;

  private constructor(props: {
    readonly id: RunStepId;
    readonly runId: RunId;
    readonly runAttemptId: RunAttemptId;
    readonly type: string;
    readonly name: string;
    readonly startedAt: Date;
    readonly completedAt: Date | undefined;
    readonly metadata: RunStepMetadata | undefined;
  }) {
    this.id = props.id;
    this.runId = props.runId;
    this.runAttemptId = props.runAttemptId;
    this.type = props.type;
    this.name = props.name;
    this.startedAt = props.startedAt;
    this.completedAt = props.completedAt;
    this.metadata = props.metadata;
  }

  static create(props: RunStepProps): RunStep {
    if (!props.id) {
      throw new DomainInvariantError("RunStep.id is required.");
    }

    if (!props.runId) {
      throw new DomainInvariantError(
        "RunStep must belong to a Run (runId is required).",
      );
    }

    if (!props.runAttemptId) {
      throw new DomainInvariantError(
        "RunStep must belong to a RunAttempt (runAttemptId is required).",
      );
    }

    const startedAt = copyInstant(props.startedAt);
    const completedAt =
      props.completedAt === undefined
        ? undefined
        : copyInstant(props.completedAt);

    if (completedAt && completedAt.getTime() < startedAt.getTime()) {
      throw new DomainInvariantError(
        "RunStep.completedAt cannot be earlier than startedAt.",
      );
    }

    return Object.freeze(
      new RunStep({
        id: props.id,
        runId: props.runId,
        runAttemptId: props.runAttemptId,
        type: requireNonEmptyString(props.type, "RunStep.type"),
        name: requireNonEmptyString(props.name, "RunStep.name"),
        startedAt,
        completedAt,
        metadata:
          props.metadata === undefined
            ? undefined
            : freezeRecord(props.metadata),
      }),
    );
  }
}
