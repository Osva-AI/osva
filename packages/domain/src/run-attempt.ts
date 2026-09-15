import type { RunAttemptId, RunId } from "@osva/contracts";
import type { RunAttemptState } from "@osva/contracts";

import {
  DomainInvariantError,
  InvalidAttemptSequenceError,
  InvalidSubsequentAttemptError,
} from "./errors.js";
import {
  copyInstant,
  copyCanonicalJsonValue,
  freezeClone,
  freezeRecord,
} from "./internals.js";
import {
  assertLegalRunAttemptTransition,
  isRetryableRunAttemptState,
  isRunAttemptState,
  isTerminalRunAttemptState,
} from "./run-attempt-state-machine.js";

export interface RunAttemptError {
  readonly code: string;
  readonly message: string;
}

export type InfrastructureMetadata = Readonly<Record<string, unknown>>;

export interface CreateFirstAttemptProps {
  readonly id: RunAttemptId;
  readonly runId: RunId;
  readonly createdAt: Date;
  readonly infrastructureMetadata?: InfrastructureMetadata;
}

export interface CreateSubsequentAttemptProps {
  readonly id: RunAttemptId;
  readonly createdAt: Date;
  readonly infrastructureMetadata?: InfrastructureMetadata;
}

export interface RunAttemptRehydrateProps {
  readonly id: RunAttemptId;
  readonly runId: RunId;
  readonly sequence: number;
  readonly status: RunAttemptState;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly error?: RunAttemptError;
  readonly output?: unknown;
  readonly infrastructureMetadata?: InfrastructureMetadata;
}

export class RunAttempt {
  readonly id: RunAttemptId;
  readonly runId: RunId;
  readonly sequence: number;
  readonly status: RunAttemptState;
  readonly createdAt: Date;
  readonly startedAt: Date | undefined;
  readonly completedAt: Date | undefined;
  readonly error: RunAttemptError | undefined;
  readonly output: unknown | undefined;
  readonly infrastructureMetadata: InfrastructureMetadata | undefined;

  private constructor(props: {
    readonly id: RunAttemptId;
    readonly runId: RunId;
    readonly sequence: number;
    readonly status: RunAttemptState;
    readonly createdAt: Date;
    readonly startedAt: Date | undefined;
    readonly completedAt: Date | undefined;
    readonly error: RunAttemptError | undefined;
    readonly output: unknown | undefined;
    readonly infrastructureMetadata: InfrastructureMetadata | undefined;
  }) {
    this.id = props.id;
    this.runId = props.runId;
    this.sequence = props.sequence;
    this.status = props.status;
    this.createdAt = props.createdAt;
    this.startedAt = props.startedAt;
    this.completedAt = props.completedAt;
    this.error = props.error;
    this.output = props.output;
    this.infrastructureMetadata = props.infrastructureMetadata;
  }

  static createFirst(props: CreateFirstAttemptProps): RunAttempt {
    return RunAttempt.instantiate({
      id: props.id,
      runId: props.runId,
      sequence: 1,
      status: "PENDING",
      createdAt: props.createdAt,
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
      output: undefined,
      infrastructureMetadata: props.infrastructureMetadata,
    });
  }

  static createSubsequent(
    previous: RunAttempt,
    props: CreateSubsequentAttemptProps,
  ): RunAttempt {
    if (!isRetryableRunAttemptState(previous.status)) {
      throw new InvalidSubsequentAttemptError(previous.status);
    }

    if (props.id === previous.id) {
      throw new DomainInvariantError(
        "A new logical attempt requires a new RunAttemptId. Queue redelivery must reuse the existing RunAttempt.",
      );
    }

    return RunAttempt.instantiate({
      id: props.id,
      runId: previous.runId,
      sequence: previous.sequence + 1,
      status: "PENDING",
      createdAt: props.createdAt,
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
      output: undefined,
      infrastructureMetadata: props.infrastructureMetadata,
    });
  }

  static rehydrate(props: RunAttemptRehydrateProps): RunAttempt {
    return RunAttempt.instantiate({
      id: props.id,
      runId: props.runId,
      sequence: props.sequence,
      status: props.status,
      createdAt: props.createdAt,
      startedAt: props.startedAt,
      completedAt: props.completedAt,
      error: props.error,
      output: props.output,
      infrastructureMetadata: props.infrastructureMetadata,
    });
  }

  transitionTo(
    target: RunAttemptState,
    now: Date,
    options?: {
      readonly error?: RunAttemptError;
      readonly output?: unknown;
      readonly infrastructureMetadata?: InfrastructureMetadata;
    },
  ): RunAttempt {
    assertLegalRunAttemptTransition(this.status, target);

    const startedAt =
      this.startedAt ?? (target === "RUNNING" ? now : undefined);
    const completedAt = isTerminalRunAttemptState(target)
      ? now
      : this.completedAt;
    const error =
      target === "SUCCEEDED" ? undefined : (options?.error ?? this.error);
    const output =
      target === "SUCCEEDED"
        ? copyCanonicalJsonValue(
            options && Object.hasOwn(options, "output")
              ? options.output
              : undefined,
            "RunAttempt.output",
          )
        : undefined;

    return RunAttempt.instantiate({
      id: this.id,
      runId: this.runId,
      sequence: this.sequence,
      status: target,
      createdAt: this.createdAt,
      startedAt,
      completedAt,
      error,
      output,
      infrastructureMetadata:
        options?.infrastructureMetadata ?? this.infrastructureMetadata,
    });
  }

  private static instantiate(props: {
    readonly id: RunAttemptId;
    readonly runId: RunId;
    readonly sequence: number;
    readonly status: RunAttemptState;
    readonly createdAt: Date;
    readonly startedAt: Date | undefined;
    readonly completedAt: Date | undefined;
    readonly error: RunAttemptError | undefined;
    readonly output: unknown | undefined;
    readonly infrastructureMetadata: InfrastructureMetadata | undefined;
  }): RunAttempt {
    if (!props.id) {
      throw new DomainInvariantError("RunAttempt.id is required.");
    }

    if (!props.runId) {
      throw new DomainInvariantError("RunAttempt.runId is required.");
    }

    if (!Number.isInteger(props.sequence) || props.sequence < 1) {
      throw new InvalidAttemptSequenceError(
        `RunAttempt sequence must be a positive integer, received ${String(props.sequence)}.`,
      );
    }

    if (!isRunAttemptState(props.status)) {
      throw new DomainInvariantError(
        `Invalid run attempt status: ${props.status}`,
      );
    }

    const createdAt = copyInstant(props.createdAt);
    const startedAt =
      props.startedAt === undefined ? undefined : copyInstant(props.startedAt);
    const completedAt =
      props.completedAt === undefined
        ? undefined
        : copyInstant(props.completedAt);

    if (startedAt && startedAt.getTime() < createdAt.getTime()) {
      throw new DomainInvariantError(
        "RunAttempt.startedAt cannot be earlier than createdAt.",
      );
    }

    if (completedAt) {
      const baseline = startedAt ?? createdAt;
      if (completedAt.getTime() < baseline.getTime()) {
        throw new DomainInvariantError(
          "RunAttempt.completedAt cannot be earlier than startedAt or createdAt.",
        );
      }
    }

    return Object.freeze(
      new RunAttempt({
        id: props.id,
        runId: props.runId,
        sequence: props.sequence,
        status: props.status,
        createdAt,
        startedAt,
        completedAt,
        error: props.error === undefined ? undefined : freezeClone(props.error),
        output:
          props.output === undefined
            ? undefined
            : copyCanonicalJsonValue(props.output, "RunAttempt.output"),
        infrastructureMetadata:
          props.infrastructureMetadata === undefined
            ? undefined
            : freezeRecord(props.infrastructureMetadata),
      }),
    );
  }
}
