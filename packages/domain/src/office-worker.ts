import type { AgentId, OfficeWorkerId, WorkspaceId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface OfficeWorkerProps {
  readonly id: OfficeWorkerId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly agentId: AgentId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateOfficeWorkerProps {
  readonly id: OfficeWorkerId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly agentId: AgentId;
  readonly now: Date;
}

export interface UpdateOfficeWorkerProps {
  readonly name?: string;
  readonly description?: string;
  readonly now: Date;
}

export class OfficeWorker {
  readonly id: OfficeWorkerId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly agentId: AgentId;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: OfficeWorkerProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.name = props.name;
    this.description = props.description;
    this.agentId = props.agentId;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: CreateOfficeWorkerProps): OfficeWorker {
    if (!props.id) {
      throw new DomainInvariantError("OfficeWorker.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("OfficeWorker.workspaceId is required.");
    }

    if (!props.agentId) {
      throw new DomainInvariantError("OfficeWorker.agentId is required.");
    }

    const now = copyInstant(props.now);

    return Object.freeze(
      new OfficeWorker({
        id: props.id,
        workspaceId: props.workspaceId,
        key: requireNonEmptyString(props.key, "OfficeWorker.key"),
        name: requireNonEmptyString(props.name, "OfficeWorker.name"),
        description:
          props.description === undefined
            ? undefined
            : requireNonEmptyString(
                props.description,
                "OfficeWorker.description",
              ),
        agentId: props.agentId,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  static rehydrate(props: OfficeWorkerProps): OfficeWorker {
    return Object.freeze(
      new OfficeWorker({
        id: props.id,
        workspaceId: props.workspaceId,
        key: props.key,
        name: props.name,
        description: props.description,
        agentId: props.agentId,
        createdAt: copyInstant(props.createdAt),
        updatedAt: copyInstant(props.updatedAt),
      }),
    );
  }

  update(props: UpdateOfficeWorkerProps): OfficeWorker {
    const name =
      props.name === undefined
        ? this.name
        : requireNonEmptyString(props.name, "OfficeWorker.name");
    const description =
      props.description === undefined ? this.description : props.description;

    return OfficeWorker.rehydrate({
      id: this.id,
      workspaceId: this.workspaceId,
      key: this.key,
      name,
      description:
        description === undefined
          ? undefined
          : requireNonEmptyString(description, "OfficeWorker.description"),
      agentId: this.agentId,
      createdAt: this.createdAt,
      updatedAt: copyInstant(props.now),
    });
  }
}
