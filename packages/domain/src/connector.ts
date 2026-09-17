import type { ConnectorId, WorkspaceId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface ConnectorProps {
  readonly id: ConnectorId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class Connector {
  readonly id: ConnectorId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: ConnectorProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.name = props.name;
    this.description = props.description;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: ConnectorProps): Connector {
    if (!props.id) {
      throw new DomainInvariantError("Connector.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("Connector.workspaceId is required.");
    }

    return Object.freeze(
      new Connector({
        id: props.id,
        workspaceId: props.workspaceId,
        key: requireNonEmptyString(props.key, "Connector.key"),
        name: requireNonEmptyString(props.name, "Connector.name"),
        description:
          props.description === undefined
            ? undefined
            : requireNonEmptyString(props.description, "Connector.description"),
        createdAt: copyInstant(props.createdAt),
        updatedAt: copyInstant(props.updatedAt),
      }),
    );
  }

  withMetadata(metadata: {
    readonly name: string;
    readonly description?: string;
    readonly updatedAt: Date;
  }): Connector {
    return Connector.create({
      id: this.id,
      workspaceId: this.workspaceId,
      key: this.key,
      name: metadata.name,
      description: metadata.description,
      createdAt: this.createdAt,
      updatedAt: copyInstant(metadata.updatedAt),
    });
  }
}
