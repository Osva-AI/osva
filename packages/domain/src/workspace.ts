import type { OrganizationId, WorkspaceId } from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface WorkspaceProps {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly createdAt: Date;
  readonly organizationId?: OrganizationId;
}

export class Workspace {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly createdAt: Date;
  readonly organizationId: OrganizationId | undefined;

  private constructor(props: WorkspaceProps) {
    this.id = props.id;
    this.name = props.name;
    this.createdAt = props.createdAt;
    this.organizationId = props.organizationId;
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
        organizationId: props.organizationId,
      }),
    );
  }

  withOrganizationId(organizationId: OrganizationId): Workspace {
    return Workspace.create({
      id: this.id,
      name: this.name,
      createdAt: this.createdAt,
      organizationId,
    });
  }
}
