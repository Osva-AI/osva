import type { MemoryNamespaceId, WorkspaceId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface MemoryNamespaceProps {
  readonly id: MemoryNamespaceId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class MemoryNamespace {
  readonly id: MemoryNamespaceId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: MemoryNamespaceProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.name = props.name;
    this.description = props.description;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: MemoryNamespaceProps): MemoryNamespace {
    if (!props.id) {
      throw new DomainInvariantError("MemoryNamespace.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError(
        "MemoryNamespace.workspaceId is required.",
      );
    }

    return Object.freeze(
      new MemoryNamespace({
        id: props.id,
        workspaceId: props.workspaceId,
        key: requireNonEmptyString(props.key, "MemoryNamespace.key"),
        name: requireNonEmptyString(props.name, "MemoryNamespace.name"),
        description:
          props.description === undefined
            ? undefined
            : requireNonEmptyString(
                props.description,
                "MemoryNamespace.description",
              ),
        createdAt: copyInstant(props.createdAt),
        updatedAt: copyInstant(props.updatedAt),
      }),
    );
  }
}
