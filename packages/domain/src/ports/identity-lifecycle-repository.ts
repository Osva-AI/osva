import type { WorkspaceId, WorkspaceMembershipId } from "@osva-ai/contracts";
import type { HumanWorkspaceRole } from "@osva-ai/contracts";

import type { Organization } from "../organization.js";
import type { OrganizationMembership } from "../organization-membership.js";
import type { SecurityAuditEvent } from "../security-audit-event.js";
import type { User } from "../user.js";
import type { WorkspaceMembership } from "../workspace-membership.js";

export interface RegisterUserInput {
  readonly user: User;
  readonly auditEvent: SecurityAuditEvent;
}

export interface CreateOrganizationWithOwnerInput {
  readonly organization: Organization;
  readonly ownerMembership: OrganizationMembership;
  readonly auditEvent: SecurityAuditEvent;
}

export interface AssignWorkspaceOwnerMembershipInput {
  readonly workspaceId: WorkspaceId;
  readonly membership: WorkspaceMembership;
  readonly auditEvent: SecurityAuditEvent;
}

export interface CreateWorkspaceMembershipInput {
  readonly workspaceId: WorkspaceId;
  readonly membership: WorkspaceMembership;
  readonly auditEvent: SecurityAuditEvent;
}

export interface TransferWorkspaceOwnershipInput {
  readonly workspaceId: WorkspaceId;
  readonly fromMembershipId: WorkspaceMembershipId;
  readonly toMembershipId: WorkspaceMembershipId;
  readonly demotedRole: HumanWorkspaceRole;
  readonly auditEvent: SecurityAuditEvent;
}

export interface ChangeWorkspaceMembershipRoleInput {
  readonly workspaceId: WorkspaceId;
  readonly membership: WorkspaceMembership;
  readonly previousRole: HumanWorkspaceRole;
  readonly auditEvent: SecurityAuditEvent;
}

export interface RemoveWorkspaceMembershipInput {
  readonly workspaceId: WorkspaceId;
  readonly membershipId: WorkspaceMembershipId;
  readonly membershipRole: HumanWorkspaceRole;
  readonly auditEvent: SecurityAuditEvent;
}

export interface IdentityLifecycleRepository {
  registerUser(input: RegisterUserInput): Promise<void>;
  createOrganizationWithOwner(
    input: CreateOrganizationWithOwnerInput,
  ): Promise<void>;
  assignWorkspaceOwnerMembership(
    input: AssignWorkspaceOwnerMembershipInput,
  ): Promise<void>;
  createWorkspaceMembership(
    input: CreateWorkspaceMembershipInput,
  ): Promise<void>;
  transferWorkspaceOwnership(
    input: TransferWorkspaceOwnershipInput,
  ): Promise<void>;
  changeWorkspaceMembershipRole(
    input: ChangeWorkspaceMembershipRoleInput,
  ): Promise<void>;
  removeWorkspaceMembership(
    input: RemoveWorkspaceMembershipInput,
  ): Promise<void>;
}
