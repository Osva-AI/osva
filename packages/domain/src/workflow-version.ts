import type {
  WorkflowDefinition,
  WorkflowId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  copyInstant,
  freezeClone,
  requirePositiveInteger,
} from "./internals.js";
import { assertWorkflowDefinition } from "./workflow-definition.js";

export interface WorkflowVersionProps {
  readonly id: WorkflowVersionId;
  readonly workflowId: WorkflowId;
  readonly workspaceId: WorkspaceId;
  readonly version: number;
  readonly definition: WorkflowDefinition;
  readonly createdAt: Date;
}

export class WorkflowVersion {
  readonly id: WorkflowVersionId;
  readonly workflowId: WorkflowId;
  readonly workspaceId: WorkspaceId;
  readonly version: number;
  readonly definition: WorkflowDefinition;
  readonly createdAt: Date;

  private constructor(props: WorkflowVersionProps) {
    this.id = props.id;
    this.workflowId = props.workflowId;
    this.workspaceId = props.workspaceId;
    this.version = props.version;
    this.definition = props.definition;
    this.createdAt = props.createdAt;
  }

  static create(props: WorkflowVersionProps): WorkflowVersion {
    if (!props.id) {
      throw new DomainInvariantError("WorkflowVersion.id is required.");
    }

    if (!props.workflowId) {
      throw new DomainInvariantError("WorkflowVersion.workflowId is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError(
        "WorkflowVersion.workspaceId is required.",
      );
    }

    if (props.definition === null || typeof props.definition !== "object") {
      throw new DomainInvariantError(
        "WorkflowVersion.definition must be a snapshot object.",
      );
    }

    const definition = freezeClone(props.definition);
    assertWorkflowDefinition(definition);

    return Object.freeze(
      new WorkflowVersion({
        id: props.id,
        workflowId: props.workflowId,
        workspaceId: props.workspaceId,
        version: requirePositiveInteger(
          props.version,
          "WorkflowVersion.version",
        ),
        definition,
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}
