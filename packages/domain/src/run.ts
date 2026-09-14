import type { AgentId, RunId, WorkspaceId } from "@osva/contracts";
import type { RunState } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { EffectiveRunBindings } from "./effective-run-bindings.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";
import { assertLegalRunTransition, isRunState } from "./run-state-machine.js";

export interface RunCreateProps {
  readonly id: RunId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly effectiveBindings: EffectiveRunBindings;
  readonly createdAt: Date;
  readonly idempotencyKey?: string;
}

export interface RunRehydrateProps {
  readonly id: RunId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly status: RunState;
  readonly effectiveBindings: EffectiveRunBindings;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly idempotencyKey?: string;
}

export class Run {
  readonly id: RunId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly status: RunState;
  readonly effectiveBindings: EffectiveRunBindings;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly idempotencyKey: string | undefined;

  private constructor(props: {
    readonly id: RunId;
    readonly workspaceId: WorkspaceId;
    readonly agentId: AgentId;
    readonly status: RunState;
    readonly effectiveBindings: EffectiveRunBindings;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly idempotencyKey: string | undefined;
  }) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.agentId = props.agentId;
    this.status = props.status;
    this.effectiveBindings = props.effectiveBindings;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.idempotencyKey = props.idempotencyKey;
  }

  static create(props: RunCreateProps): Run {
    return Run.instantiate({
      id: props.id,
      workspaceId: props.workspaceId,
      agentId: props.agentId,
      status: "PENDING",
      effectiveBindings: props.effectiveBindings,
      createdAt: props.createdAt,
      updatedAt: props.createdAt,
      idempotencyKey: props.idempotencyKey,
    });
  }

  static rehydrate(props: RunRehydrateProps): Run {
    return Run.instantiate({
      id: props.id,
      workspaceId: props.workspaceId,
      agentId: props.agentId,
      status: props.status,
      effectiveBindings: props.effectiveBindings,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      idempotencyKey: props.idempotencyKey,
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
      createdAt: this.createdAt,
      updatedAt: now,
      idempotencyKey: this.idempotencyKey,
    });
  }

  private static instantiate(props: {
    readonly id: RunId;
    readonly workspaceId: WorkspaceId;
    readonly agentId: AgentId;
    readonly status: RunState;
    readonly effectiveBindings: EffectiveRunBindings;
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly idempotencyKey: string | undefined;
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
        createdAt,
        updatedAt,
        idempotencyKey:
          props.idempotencyKey === undefined
            ? undefined
            : requireNonEmptyString(props.idempotencyKey, "Run.idempotencyKey"),
      }),
    );
  }
}
