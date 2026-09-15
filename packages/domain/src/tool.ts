import type { ToolId, WorkspaceId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface ToolProps {
  readonly id: ToolId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly createdAt: Date;
}

export class Tool {
  readonly id: ToolId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly createdAt: Date;

  private constructor(props: ToolProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.name = props.name;
    this.createdAt = props.createdAt;
  }

  static create(props: ToolProps): Tool {
    if (!props.id) {
      throw new DomainInvariantError("Tool.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("Tool.workspaceId is required.");
    }

    return Object.freeze(
      new Tool({
        id: props.id,
        workspaceId: props.workspaceId,
        key: requireNonEmptyString(props.key, "Tool.key"),
        name: requireNonEmptyString(props.name, "Tool.name"),
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }

  withName(name: string): Tool {
    return Tool.create({
      id: this.id,
      workspaceId: this.workspaceId,
      key: this.key,
      name,
      createdAt: this.createdAt,
    });
  }
}
