import type {
  UserId,
  WorkspaceId,
  WorkspaceMembershipId,
} from "@osva-ai/contracts";
import type { HumanWorkspaceRole } from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant } from "./internals.js";

export interface WorkspaceMembershipProps {
  readonly id: WorkspaceMembershipId;
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly role: HumanWorkspaceRole;
  readonly createdAt: Date;
}

export class WorkspaceMembership {
  readonly id: WorkspaceMembershipId;
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly role: HumanWorkspaceRole;
  readonly createdAt: Date;

  private constructor(props: WorkspaceMembershipProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.userId = props.userId;
    this.role = props.role;
    this.createdAt = props.createdAt;
  }

  static create(props: WorkspaceMembershipProps): WorkspaceMembership {
    if (!props.id) {
      throw new DomainInvariantError("WorkspaceMembership.id is required.");
    }
    if (!props.workspaceId) {
      throw new DomainInvariantError(
        "WorkspaceMembership.workspaceId is required.",
      );
    }
    if (!props.userId) {
      throw new DomainInvariantError("WorkspaceMembership.userId is required.");
    }

    return Object.freeze(
      new WorkspaceMembership({
        id: props.id,
        workspaceId: props.workspaceId,
        userId: props.userId,
        role: props.role,
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }

  withRole(role: HumanWorkspaceRole): WorkspaceMembership {
    return WorkspaceMembership.create({
      id: this.id,
      workspaceId: this.workspaceId,
      userId: this.userId,
      role,
      createdAt: this.createdAt,
    });
  }
}
