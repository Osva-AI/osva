import type { WorkspaceId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface WorkspaceProps {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly createdAt: Date;
}

export class Workspace {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly createdAt: Date;

  private constructor(props: WorkspaceProps) {
    this.id = props.id;
    this.name = props.name;
    this.createdAt = props.createdAt;
  }

  static create(props: WorkspaceProps): Workspace {
    if (!props.id) {
      throw new DomainInvariantError("Workspace.id is required.");
    }

    return Object.freeze(
      new Workspace({
        id: props.id,
        name: requireNonEmptyString(props.name, "Workspace.name"),
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}
