import type { WorkflowId, WorkspaceId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface WorkflowProps {
  readonly id: WorkflowId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Workflow {
  readonly id: WorkflowId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: {
    readonly id: WorkflowId;
    readonly workspaceId: WorkspaceId;
    readonly key: string;
    readonly name: string;
    readonly description: string | undefined;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.name = props.name;
    this.description = props.description;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: WorkflowProps): Workflow {
    if (!props.id) {
      throw new DomainInvariantError("Workflow.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("Workflow.workspaceId is required.");
    }

    const createdAt = copyInstant(props.createdAt);
    const updatedAt = copyInstant(props.updatedAt);
    if (updatedAt.getTime() < createdAt.getTime()) {
      throw new DomainInvariantError(
        "Workflow.updatedAt cannot be earlier than createdAt.",
      );
    }

    return Object.freeze(
      new Workflow({
        id: props.id,
        workspaceId: props.workspaceId,
        key: requireNonEmptyString(props.key, "Workflow.key"),
        name: requireNonEmptyString(props.name, "Workflow.name"),
        description:
          props.description === undefined
            ? undefined
            : requireNonEmptyString(props.description, "Workflow.description"),
        createdAt,
        updatedAt,
      }),
    );
  }
}
