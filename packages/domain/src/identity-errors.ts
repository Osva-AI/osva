import type {
  OrganizationId,
  OrganizationMembershipId,
  UserId,
  WorkspaceId,
  WorkspaceMembershipId,
} from "@osva-ai/contracts";

import { DomainError } from "./errors.js";

export class DuplicateUserEmailError extends DomainError {
  readonly email: string;

  constructor(email: string) {
    super(`User email '${email}' is already registered.`);
    this.email = email;
  }
}

export class DuplicateOrganizationMembershipError extends DomainError {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;

  constructor(organizationId: OrganizationId, userId: UserId) {
    super(
      `Organization membership already exists for user '${userId}' in organization '${organizationId}'.`,
    );
    this.organizationId = organizationId;
    this.userId = userId;
  }
}

export class DuplicateWorkspaceMembershipError extends DomainError {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;

  constructor(workspaceId: WorkspaceId, userId: UserId) {
    super(
      `Workspace membership already exists for user '${userId}' in workspace '${workspaceId}'.`,
    );
    this.workspaceId = workspaceId;
    this.userId = userId;
  }
}

export class WorkspaceOwnerInvariantError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

export class OrganizationMembershipNotFoundError extends DomainError {
  readonly membershipId: OrganizationMembershipId;

  constructor(membershipId: OrganizationMembershipId) {
    super(`Organization membership '${membershipId}' was not found.`);
    this.membershipId = membershipId;
  }
}

export class WorkspaceMembershipNotFoundError extends DomainError {
  readonly membershipId: WorkspaceMembershipId;

  constructor(membershipId: WorkspaceMembershipId) {
    super(`Workspace membership '${membershipId}' was not found.`);
    this.membershipId = membershipId;
  }
}

export class UserNotFoundError extends DomainError {
  readonly userId: UserId;

  constructor(userId: UserId) {
    super(`User '${userId}' was not found.`);
    this.userId = userId;
  }
}

export class OrganizationNotFoundError extends DomainError {
  readonly organizationId: OrganizationId;

  constructor(organizationId: OrganizationId) {
    super(`Organization '${organizationId}' was not found.`);
    this.organizationId = organizationId;
  }
}
