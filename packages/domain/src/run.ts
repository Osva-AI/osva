import type {
  AgentId,
  EvaluationCaseId,
  EvaluationRunId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";
import type { RunState } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { EffectiveRunBindings } from "./effective-run-bindings.js";
import {
  copyInstant,
  copyJsonValue,
  requireNonEmptyString,
} from "./internals.js";
import { assertLegalRunTransition, isRunState } from "./run-state-machine.js";

export interface RunCreateProps {
  readonly id: RunId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly effectiveBindings: EffectiveRunBindings;
  readonly input: unknown;
  readonly createdAt: Date;
  readonly idempotencyKey?: string;
  readonly evaluationRunId?: EvaluationRunId;
  readonly evaluationCaseId?: EvaluationCaseId;
}

export interface RunRehydrateProps {
  readonly id: RunId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly status: RunState;
  readonly effectiveBindings: EffectiveRunBindings;
  readonly input: unknown;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly idempotencyKey?: string;
  readonly evaluationRunId?: EvaluationRunId;
  readonly evaluationCaseId?: EvaluationCaseId;
}

export class Run {
  readonly id: RunId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly status: RunState;
  readonly effectiveBindings: EffectiveRunBindings;
  readonly input: unknown;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly idempotencyKey: string | undefined;
  readonly evaluationRunId: EvaluationRunId | undefined;
  readonly evaluationCaseId: EvaluationCaseId | undefined;

  private constructor(props: {
    readonly id: RunId;
    readonly workspaceId: WorkspaceId;
    readonly agentId: AgentId;
    readonly status: RunState;
    readonly effectiveBindings: EffectiveRunBindings;
    readonly input: unknown;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly idempotencyKey: string | undefined;
    readonly evaluationRunId: EvaluationRunId | undefined;
    readonly evaluationCaseId: EvaluationCaseId | undefined;
  }) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.agentId = props.agentId;
    this.status = props.status;
    this.effectiveBindings = props.effectiveBindings;
    this.input = props.input;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.idempotencyKey = props.idempotencyKey;
    this.evaluationRunId = props.evaluationRunId;
    this.evaluationCaseId = props.evaluationCaseId;
  }

  get isEvaluationChildRun(): boolean {
    return (
      this.evaluationRunId !== undefined && this.evaluationCaseId !== undefined
    );
  }

  static create(props: RunCreateProps): Run {
    return Run.instantiate({
      id: props.id,
      workspaceId: props.workspaceId,
      agentId: props.agentId,
      status: "PENDING",
      effectiveBindings: props.effectiveBindings,
      input: props.input,
      createdAt: props.createdAt,
      updatedAt: props.createdAt,
      idempotencyKey: props.idempotencyKey,
      evaluationRunId: props.evaluationRunId,
      evaluationCaseId: props.evaluationCaseId,
    });
  }

  static rehydrate(props: RunRehydrateProps): Run {
    return Run.instantiate({
      id: props.id,
      workspaceId: props.workspaceId,
      agentId: props.agentId,
      status: props.status,
      effectiveBindings: props.effectiveBindings,
      input: props.input,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      idempotencyKey: props.idempotencyKey,
      evaluationRunId: props.evaluationRunId,
      evaluationCaseId: props.evaluationCaseId,
    });
  }

  transitionTo(target: RunState, now: Date): Run {
    assertLegalRunTransition(this.status, target);

    return Run.instantiate({
      id: this.id,
      workspaceId: this.workspaceId,
      agentId: this.agentId,
      status: target,
      effectiveBindings: this.effectiveBindings,
      input: this.input,
      createdAt: this.createdAt,
      updatedAt: now,
      idempotencyKey: this.idempotencyKey,
      evaluationRunId: this.evaluationRunId,
      evaluationCaseId: this.evaluationCaseId,
    });
  }

  private static instantiate(props: {
    readonly id: RunId;
    readonly workspaceId: WorkspaceId;
    readonly agentId: AgentId;
    readonly status: RunState;
    readonly effectiveBindings: EffectiveRunBindings;
    readonly input: unknown;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly idempotencyKey: string | undefined;
    readonly evaluationRunId: EvaluationRunId | undefined;
    readonly evaluationCaseId: EvaluationCaseId | undefined;
  }): Run {
    if (!props.id) {
      throw new DomainInvariantError("Run.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("Run.workspaceId is required.");
    }

    if (!props.agentId) {
      throw new DomainInvariantError("Run.agentId is required.");
    }

    if (!(props.effectiveBindings instanceof EffectiveRunBindings)) {
      throw new DomainInvariantError(
        "Run.effectiveBindings must be an EffectiveRunBindings value.",
      );
    }

    if (!isRunState(props.status)) {
      throw new DomainInvariantError(`Invalid run status: ${props.status}`);
    }

    const createdAt = copyInstant(props.createdAt);
    const updatedAt = copyInstant(props.updatedAt);

    if (updatedAt.getTime() < createdAt.getTime()) {
      throw new DomainInvariantError(
        "Run.updatedAt cannot be earlier than createdAt.",
      );
    }

    return Object.freeze(
      new Run({
        id: props.id,
        workspaceId: props.workspaceId,
        agentId: props.agentId,
        status: props.status,
        effectiveBindings: props.effectiveBindings,
        input: copyJsonValue(props.input, "Run.input"),
        createdAt,
        updatedAt,
        idempotencyKey:
          props.idempotencyKey === undefined
            ? undefined
            : requireNonEmptyString(props.idempotencyKey, "Run.idempotencyKey"),
        evaluationRunId: props.evaluationRunId,
        evaluationCaseId: props.evaluationCaseId,
      }),
    );
  }
}
