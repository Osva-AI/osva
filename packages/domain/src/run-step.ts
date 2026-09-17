import type {
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  RunStepId,
  RunStepKind,
  RunStepStatus,
  ToolVersionId,
} from "@osva/contracts";
import { isRunStepKind, isRunStepStatus } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  copyInstant,
  requireNonEmptyString,
  requireNonNegativeInteger,
} from "./internals.js";

export interface RunStepIdentityProps {
  readonly id: RunStepId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly kind: RunStepKind;
  readonly bindingName: string;
  readonly startedAt: Date;
  readonly modelProfileVersionId?: ModelProfileVersionId;
  readonly toolVersionId?: ToolVersionId;
}

export interface RunStepProps extends RunStepIdentityProps {
  readonly status: RunStepStatus;
  readonly completedAt?: Date;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly estimatedCostUsdMicros?: number | null;
  readonly errorCode?: string;
}

export interface StartRunStepProps extends RunStepIdentityProps {
  readonly status: "RUNNING";
}

export interface FinalizeRunStepProps {
  readonly status: "SUCCEEDED" | "FAILED";
  readonly completedAt: Date;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly estimatedCostUsdMicros?: number | null;
  readonly errorCode?: string;
}

export class RunStep {
  readonly id: RunStepId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly kind: RunStepKind;
  readonly bindingName: string;
  readonly status: RunStepStatus;
  readonly startedAt: Date;
  readonly completedAt: Date | undefined;
  readonly modelProfileVersionId: ModelProfileVersionId | undefined;
  readonly toolVersionId: ToolVersionId | undefined;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly totalTokens: number | undefined;
  readonly cachedInputTokens: number | undefined;
  readonly estimatedCostUsdMicros: number | null | undefined;
  readonly errorCode: string | undefined;

  private constructor(props: RunStepProps) {
    this.id = props.id;
    this.runId = props.runId;
    this.runAttemptId = props.runAttemptId;
    this.kind = props.kind;
    this.bindingName = props.bindingName;
    this.status = props.status;
    this.startedAt = props.startedAt;
    this.completedAt = props.completedAt;
    this.modelProfileVersionId = props.modelProfileVersionId;
    this.toolVersionId = props.toolVersionId;
    this.inputTokens = props.inputTokens;
    this.outputTokens = props.outputTokens;
    this.totalTokens = props.totalTokens;
    this.cachedInputTokens = props.cachedInputTokens;
    this.estimatedCostUsdMicros = props.estimatedCostUsdMicros;
    this.errorCode = props.errorCode;
  }

  static start(props: RunStepIdentityProps): RunStep {
    assertIdentity(props);
    assertKindTarget(props);

    return Object.freeze(
      new RunStep({
        ...props,
        status: "RUNNING",
      }),
    );
  }

  static create(props: RunStepProps): RunStep {
    assertIdentity(props);
    assertKindTarget(props);

    if (!isRunStepStatus(props.status)) {
      throw new DomainInvariantError("RunStep.status is invalid.");
    }

    const startedAt = copyInstant(props.startedAt);
    const completedAt =
      props.completedAt === undefined
        ? undefined
        : copyInstant(props.completedAt);

    if (props.status !== "RUNNING") {
      if (completedAt === undefined) {
        throw new DomainInvariantError(
          "Terminal RunStep.completedAt is required.",
        );
      }

      if (completedAt.getTime() < startedAt.getTime()) {
        throw new DomainInvariantError(
          "RunStep.completedAt cannot be earlier than startedAt.",
        );
      }
    }

    if (props.status === "FAILED") {
      if (
        props.errorCode === undefined ||
        props.errorCode.trim().length === 0
      ) {
        throw new DomainInvariantError("Failed RunStep.errorCode is required.");
      }
    }

    if (props.status === "SUCCEEDED" && props.errorCode !== undefined) {
      throw new DomainInvariantError(
        "Succeeded RunStep must not carry errorCode.",
      );
    }

    return Object.freeze(
      new RunStep({
        id: props.id,
        runId: props.runId,
        runAttemptId: props.runAttemptId,
        kind: props.kind,
        bindingName: requireNonEmptyString(
          props.bindingName,
          "RunStep.bindingName",
        ),
        status: props.status,
        startedAt,
        completedAt,
        modelProfileVersionId: props.modelProfileVersionId,
        toolVersionId: props.toolVersionId,
        inputTokens: optionalNonNegativeInteger(props.inputTokens),
        outputTokens: optionalNonNegativeInteger(props.outputTokens),
        totalTokens: optionalNonNegativeInteger(props.totalTokens),
        cachedInputTokens: optionalNonNegativeInteger(props.cachedInputTokens),
        estimatedCostUsdMicros: props.estimatedCostUsdMicros,
        errorCode:
          props.errorCode === undefined
            ? undefined
            : requireNonEmptyString(props.errorCode, "RunStep.errorCode"),
      }),
    );
  }

  finalize(props: FinalizeRunStepProps): RunStep {
    if (this.status !== "RUNNING") {
      throw new DomainInvariantError("Only RUNNING RunSteps can be finalized.");
    }

    return RunStep.create({
      id: this.id,
      runId: this.runId,
      runAttemptId: this.runAttemptId,
      kind: this.kind,
      bindingName: this.bindingName,
      startedAt: this.startedAt,
      modelProfileVersionId: this.modelProfileVersionId,
      toolVersionId: this.toolVersionId,
      status: props.status,
      completedAt: props.completedAt,
      inputTokens: props.inputTokens,
      outputTokens: props.outputTokens,
      totalTokens: props.totalTokens,
      cachedInputTokens: props.cachedInputTokens,
      estimatedCostUsdMicros: props.estimatedCostUsdMicros,
      errorCode: props.errorCode,
    });
  }
}

function assertIdentity(props: RunStepIdentityProps): void {
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

  if (!isRunStepKind(props.kind)) {
    throw new DomainInvariantError("RunStep.kind is invalid.");
  }

  requireNonEmptyString(props.bindingName, "RunStep.bindingName");
  copyInstant(props.startedAt);
}

function assertKindTarget(props: RunStepIdentityProps): void {
  if (props.kind === "MODEL") {
    if (props.modelProfileVersionId === undefined) {
      throw new DomainInvariantError(
        "MODEL RunStep.modelProfileVersionId is required.",
      );
    }

    if (props.toolVersionId !== undefined) {
      throw new DomainInvariantError(
        "MODEL RunStep must not carry toolVersionId.",
      );
    }

    return;
  }

  if (props.kind === "MEMORY") {
    if (props.modelProfileVersionId !== undefined) {
      throw new DomainInvariantError(
        "MEMORY RunStep must not carry modelProfileVersionId.",
      );
    }

    if (props.toolVersionId !== undefined) {
      throw new DomainInvariantError(
        "MEMORY RunStep must not carry toolVersionId.",
      );
    }

    return;
  }

  if (props.toolVersionId === undefined) {
    throw new DomainInvariantError("TOOL RunStep.toolVersionId is required.");
  }

  if (props.modelProfileVersionId !== undefined) {
    throw new DomainInvariantError(
      "TOOL RunStep must not carry modelProfileVersionId.",
    );
  }
}

function optionalNonNegativeInteger(
  value: number | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireNonNegativeInteger(value, "RunStep token count");
}
