import type { RoleId, WorkspaceId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface RoleProps {
  readonly id: RoleId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateRoleProps {
  readonly id: RoleId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly now: Date;
}

export interface UpdateRoleProps {
  readonly name?: string;
  readonly description?: string;
  readonly now: Date;
}

export class Role {
  readonly id: RoleId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: RoleProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.name = props.name;
    this.description = props.description;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: CreateRoleProps): Role {
    if (!props.id) {
      throw new DomainInvariantError("Role.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("Role.workspaceId is required.");
    }

    const now = copyInstant(props.now);

    return Object.freeze(
      new Role({
        id: props.id,
        workspaceId: props.workspaceId,
        key: requireNonEmptyString(props.key, "Role.key"),
        name: requireNonEmptyString(props.name, "Role.name"),
        description:
          props.description === undefined
            ? undefined
            : requireNonEmptyString(props.description, "Role.description"),
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  static rehydrate(props: RoleProps): Role {
    return Object.freeze(
      new Role({
        id: props.id,
        workspaceId: props.workspaceId,
        key: props.key,
        name: props.name,
        description: props.description,
        createdAt: copyInstant(props.createdAt),
        updatedAt: copyInstant(props.updatedAt),
      }),
    );
  }

  update(props: UpdateRoleProps): Role {
    const name =
      props.name === undefined
        ? this.name
        : requireNonEmptyString(props.name, "Role.name");
    const description =
      props.description === undefined ? this.description : props.description;

    return Role.rehydrate({
      id: this.id,
      workspaceId: this.workspaceId,
      key: this.key,
      name,
      description:
        description === undefined
          ? undefined
          : requireNonEmptyString(description, "Role.description"),
      createdAt: this.createdAt,
      updatedAt: copyInstant(props.now),
    });
  }
}
