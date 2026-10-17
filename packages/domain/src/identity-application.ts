import type {
  OrganizationId,
  OrganizationMembershipId,
  SecurityAuditEventId,
  UserId,
  WorkspaceId,
  WorkspaceMembershipId,
} from "@osva-ai/contracts";
import {
  HUMAN_WORKSPACE_ROLES,
  ORGANIZATION_MEMBERSHIP_ROLES,
  SECURITY_AUDIT_EVENT_TYPES,
  USER_STATUSES,
  type HumanWorkspaceRole,
} from "@osva-ai/contracts";

import { DomainInvariantError, WorkspaceNotFoundError } from "./errors.js";
import {
  DuplicateWorkspaceMembershipError,
  UserNotFoundError,
  WorkspaceMembershipNotFoundError,
  WorkspaceOwnerInvariantError,
} from "./identity-errors.js";
import { Organization } from "./organization.js";
import { OrganizationMembership } from "./organization-membership.js";
import { SecurityAuditEvent } from "./security-audit-event.js";
import { PermissionDeniedError } from "./security-errors.js";
import { User } from "./user.js";
import { WorkspaceMembership } from "./workspace-membership.js";
import {
  requireWorkspaceOwnerActor,
  roleChangeTouchesOwner,
} from "./workspace-membership-authorization.js";
import type { IdentityLifecycleRepository } from "./ports/identity-lifecycle-repository.js";
import type { OrganizationMembershipRepository } from "./ports/organization-membership-repository.js";
import type { UserRepository } from "./ports/user-repository.js";
import type { WorkspaceMembershipRepository } from "./ports/workspace-membership-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";
import {
  rejectOwnerMembershipMutation,
  rejectOwnerRoleForGenericMembershipRoute,
  requireMembershipInWorkspace,
} from "./workspace-membership-guards.js";

export interface IdentityApplicationClock {
  now(): Date;
}

export interface IdentityApplicationIds {
  createId(): string;
}

export interface IdentityApplicationDependencies {
  readonly users: UserRepository;
  readonly workspaceMemberships: WorkspaceMembershipRepository;
  readonly workspaces: WorkspaceRepository;
  readonly lifecycle: IdentityLifecycleRepository;
  readonly organizationMemberships?: OrganizationMembershipRepository;
  readonly clock: IdentityApplicationClock;
  readonly ids: IdentityApplicationIds;
}

export interface RegisterUserCommand {
  readonly email: string;
  readonly displayName: string;
}

export interface CreateOrganizationCommand {
  readonly name: string;
  readonly ownerUserId: UserId;
}

export interface AddWorkspaceMembershipCommand {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly role: HumanWorkspaceRole;
  readonly actorUserId?: UserId;
}

export interface ChangeWorkspaceMembershipRoleCommand {
  readonly membershipId: WorkspaceMembershipId;
  readonly role: HumanWorkspaceRole;
  readonly actorUserId?: UserId;
}

export interface TransferWorkspaceOwnershipCommand {
  readonly workspaceId: WorkspaceId;
  readonly toUserId: UserId;
  readonly actorUserId: UserId;
  readonly demotedRole?: HumanWorkspaceRole;
}

export interface RemoveWorkspaceMembershipCommand {
  readonly membershipId: WorkspaceMembershipId;
  readonly actorUserId?: UserId;
}

export interface ProvisionWorkspaceMemberCommand {
  readonly workspaceId: WorkspaceId;
  readonly email: string;
  readonly displayName: string;
  readonly role: HumanWorkspaceRole;
  readonly actorUserId: UserId;
}

export interface ScopedWorkspaceMembershipCommand {
  readonly workspaceId: WorkspaceId;
  readonly membershipId: WorkspaceMembershipId;
  readonly actorUserId: UserId;
}

export interface ScopedChangeWorkspaceMembershipRoleCommand {
  readonly workspaceId: WorkspaceId;
  readonly membershipId: WorkspaceMembershipId;
  readonly role: HumanWorkspaceRole;
  readonly actorUserId: UserId;
}

export class IdentityApplication {
  constructor(private readonly deps: IdentityApplicationDependencies) {}

  async registerUser(command: RegisterUserCommand): Promise<User> {
    const user = User.create({
      id: this.deps.ids.createId() as UserId,
      email: command.email,
      displayName: command.displayName,
      status: USER_STATUSES.ACTIVE,
      createdAt: this.deps.clock.now(),
    });

    await this.deps.lifecycle.registerUser({
      user,
      auditEvent: SecurityAuditEvent.create({
        id: this.deps.ids.createId() as SecurityAuditEventId,
        eventType: SECURITY_AUDIT_EVENT_TYPES.USER_CREATED,
        occurredAt: this.deps.clock.now(),
        actorUserId: user.id,
        details: {},
      }),
    });

    return user;
  }

  async createOrganization(
    command: CreateOrganizationCommand,
  ): Promise<Organization> {
    const owner = await this.deps.users.findById(command.ownerUserId);
    if (owner === null) {
      throw new UserNotFoundError(command.ownerUserId);
    }

    const organization = Organization.create({
      id: this.deps.ids.createId() as OrganizationId,
      name: command.name,
      createdAt: this.deps.clock.now(),
    });
    const membership = OrganizationMembership.create({
      id: this.deps.ids.createId() as OrganizationMembershipId,
      organizationId: organization.id,
      userId: owner.id,
      role: ORGANIZATION_MEMBERSHIP_ROLES.OWNER,
      createdAt: this.deps.clock.now(),
    });

    await this.deps.lifecycle.createOrganizationWithOwner({
      organization,
      ownerMembership: membership,
      auditEvent: SecurityAuditEvent.create({
        id: this.deps.ids.createId() as SecurityAuditEventId,
        eventType: SECURITY_AUDIT_EVENT_TYPES.ORGANIZATION_CREATED,
        occurredAt: this.deps.clock.now(),
        organizationId: organization.id,
        actorUserId: owner.id,
        details: { ownerUserId: owner.id },
      }),
    });

    return organization;
  }

  async addWorkspaceMembership(
    command: AddWorkspaceMembershipCommand,
  ): Promise<WorkspaceMembership> {
    const workspace = await this.deps.workspaces.findById(command.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(command.workspaceId);
    }

    const user = await this.deps.users.findById(command.userId);
    if (user === null) {
      throw new UserNotFoundError(command.userId);
    }

    if (command.role === HUMAN_WORKSPACE_ROLES.OWNER) {
      const ownerCount =
        await this.deps.workspaceMemberships.countByWorkspaceAndRole(
          command.workspaceId,
          HUMAN_WORKSPACE_ROLES.OWNER,
        );
      if (ownerCount > 0) {
        await requireWorkspaceOwnerActor(
          this.deps.workspaceMemberships,
          command.workspaceId,
          command.actorUserId,
        );
      }
    } else if (command.actorUserId !== undefined) {
      const actorMembership =
        await this.deps.workspaceMemberships.findByWorkspaceAndUser(
          command.workspaceId,
          command.actorUserId,
        );
      if (
        actorMembership === null ||
        (actorMembership.role !== HUMAN_WORKSPACE_ROLES.OWNER &&
          actorMembership.role !== HUMAN_WORKSPACE_ROLES.ADMIN)
      ) {
        throw new PermissionDeniedError();
      }
    }

    const membership = WorkspaceMembership.create({
      id: this.deps.ids.createId() as WorkspaceMembershipId,
      workspaceId: command.workspaceId,
      userId: command.userId,
      role: command.role,
      createdAt: this.deps.clock.now(),
    });

    const auditEvent = SecurityAuditEvent.create({
      id: this.deps.ids.createId() as SecurityAuditEventId,
      eventType: SECURITY_AUDIT_EVENT_TYPES.WORKSPACE_MEMBERSHIP_CREATED,
      occurredAt: this.deps.clock.now(),
      workspaceId: command.workspaceId,
      actorUserId: command.actorUserId,
      details: {
        userId: command.userId,
        role: command.role,
      },
    });

    if (command.role === HUMAN_WORKSPACE_ROLES.OWNER) {
      await this.deps.lifecycle.assignWorkspaceOwnerMembership({
        workspaceId: command.workspaceId,
        membership,
        auditEvent,
      });
    } else {
      await this.deps.lifecycle.createWorkspaceMembership({
        workspaceId: command.workspaceId,
        membership,
        auditEvent,
      });
    }

    return membership;
  }

  async changeWorkspaceMembershipRole(
    command: ChangeWorkspaceMembershipRoleCommand,
  ): Promise<WorkspaceMembership> {
    const existing = await this.deps.workspaceMemberships.findById(
      command.membershipId,
    );
    if (existing === null) {
      throw new WorkspaceMembershipNotFoundError(command.membershipId);
    }

    if (roleChangeTouchesOwner(existing.role, command.role)) {
      const ownerCount =
        await this.deps.workspaceMemberships.countByWorkspaceAndRole(
          existing.workspaceId,
          HUMAN_WORKSPACE_ROLES.OWNER,
        );
      if (ownerCount > 0 || command.role === HUMAN_WORKSPACE_ROLES.OWNER) {
        await requireWorkspaceOwnerActor(
          this.deps.workspaceMemberships,
          existing.workspaceId,
          command.actorUserId,
        );
      }
    } else if (command.actorUserId !== undefined) {
      const actorMembership =
        await this.deps.workspaceMemberships.findByWorkspaceAndUser(
          existing.workspaceId,
          command.actorUserId,
        );
      if (
        actorMembership === null ||
        (actorMembership.role !== HUMAN_WORKSPACE_ROLES.OWNER &&
          actorMembership.role !== HUMAN_WORKSPACE_ROLES.ADMIN)
      ) {
        throw new PermissionDeniedError();
      }
    }

    const updated = existing.withRole(command.role);
    await this.deps.lifecycle.changeWorkspaceMembershipRole({
      workspaceId: existing.workspaceId,
      membership: updated,
      previousRole: existing.role,
      auditEvent: SecurityAuditEvent.create({
        id: this.deps.ids.createId() as SecurityAuditEventId,
        eventType: SECURITY_AUDIT_EVENT_TYPES.WORKSPACE_MEMBERSHIP_ROLE_CHANGED,
        occurredAt: this.deps.clock.now(),
        workspaceId: existing.workspaceId,
        actorUserId: command.actorUserId,
        details: {
          membershipId: existing.id,
          previousRole: existing.role,
          role: command.role,
        },
      }),
    });

    return updated;
  }

  async transferWorkspaceOwnership(
    command: TransferWorkspaceOwnershipCommand,
  ): Promise<void> {
    const demotedRole = command.demotedRole ?? HUMAN_WORKSPACE_ROLES.ADMIN;

    await requireWorkspaceOwnerActor(
      this.deps.workspaceMemberships,
      command.workspaceId,
      command.actorUserId,
    );

    const currentOwner =
      await this.deps.workspaceMemberships.findByWorkspaceAndUser(
        command.workspaceId,
        command.actorUserId,
      );
    if (currentOwner === null) {
      throw new WorkspaceOwnerInvariantError(
        "Actor must hold a workspace membership to transfer ownership.",
      );
    }

    const target = await this.deps.workspaceMemberships.findByWorkspaceAndUser(
      command.workspaceId,
      command.toUserId,
    );
    if (target === null) {
      throw new DomainInvariantError(
        "Target user must already have a workspace membership before receiving ownership.",
      );
    }

    if (target.role === HUMAN_WORKSPACE_ROLES.OWNER) {
      throw new DomainInvariantError(
        "Target user is already a workspace OWNER.",
      );
    }

    await this.deps.lifecycle.transferWorkspaceOwnership({
      workspaceId: command.workspaceId,
      fromMembershipId: currentOwner.id,
      toMembershipId: target.id,
      demotedRole,
      auditEvent: SecurityAuditEvent.create({
        id: this.deps.ids.createId() as SecurityAuditEventId,
        eventType: SECURITY_AUDIT_EVENT_TYPES.WORKSPACE_OWNERSHIP_TRANSFERRED,
        occurredAt: this.deps.clock.now(),
        workspaceId: command.workspaceId,
        actorUserId: command.actorUserId,
        details: {
          fromUserId: currentOwner.userId,
          toUserId: command.toUserId,
          demotedRole,
        },
      }),
    });
  }

  async removeWorkspaceMembership(
    command: RemoveWorkspaceMembershipCommand,
  ): Promise<void> {
    const existing = await this.deps.workspaceMemberships.findById(
      command.membershipId,
    );
    if (existing === null) {
      throw new WorkspaceMembershipNotFoundError(command.membershipId);
    }

    if (existing.role === HUMAN_WORKSPACE_ROLES.OWNER) {
      await requireWorkspaceOwnerActor(
        this.deps.workspaceMemberships,
        existing.workspaceId,
        command.actorUserId,
      );
    } else if (command.actorUserId !== undefined) {
      const actorMembership =
        await this.deps.workspaceMemberships.findByWorkspaceAndUser(
          existing.workspaceId,
          command.actorUserId,
        );
      if (
        actorMembership === null ||
        (actorMembership.role !== HUMAN_WORKSPACE_ROLES.OWNER &&
          actorMembership.role !== HUMAN_WORKSPACE_ROLES.ADMIN)
      ) {
        throw new PermissionDeniedError();
      }
    }

    await this.deps.lifecycle.removeWorkspaceMembership({
      workspaceId: existing.workspaceId,
      membershipId: existing.id,
      membershipRole: existing.role,
      auditEvent: SecurityAuditEvent.create({
        id: this.deps.ids.createId() as SecurityAuditEventId,
        eventType: SECURITY_AUDIT_EVENT_TYPES.WORKSPACE_MEMBERSHIP_REMOVED,
        occurredAt: this.deps.clock.now(),
        workspaceId: existing.workspaceId,
        actorUserId: command.actorUserId,
        details: {
          membershipId: existing.id,
          userId: existing.userId,
          role: existing.role,
        },
      }),
    });
  }

  async addExistingUserToWorkspaceMembership(
    command: AddWorkspaceMembershipCommand & { readonly actorUserId: UserId },
  ): Promise<WorkspaceMembership> {
    rejectOwnerRoleForGenericMembershipRoute(command.role);
    const workspace = await this.deps.workspaces.findById(command.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(command.workspaceId);
    }
    const user = await this.deps.users.findById(command.userId);
    if (user === null) {
      throw new UserNotFoundError(command.userId);
    }
    if (workspace.organizationId !== undefined) {
      await this.assertUserEligibleForWorkspace(
        command.userId,
        command.workspaceId,
      );
    }

    const duplicate =
      await this.deps.workspaceMemberships.findByWorkspaceAndUser(
        command.workspaceId,
        command.userId,
      );
    if (duplicate !== null) {
      throw new DuplicateWorkspaceMembershipError(
        command.workspaceId,
        command.userId,
      );
    }

    return this.addWorkspaceMembership(command);
  }

  async provisionPendingWorkspaceMember(
    command: ProvisionWorkspaceMemberCommand,
  ): Promise<User> {
    rejectOwnerRoleForGenericMembershipRoute(command.role);
    const workspace = await this.deps.workspaces.findById(command.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(command.workspaceId);
    }

    const user = User.create({
      id: this.deps.ids.createId() as UserId,
      email: command.email,
      displayName: command.displayName,
      status: USER_STATUSES.PENDING_SETUP,
      createdAt: this.deps.clock.now(),
    });

    await this.deps.lifecycle.registerUser({
      user,
      auditEvent: SecurityAuditEvent.create({
        id: this.deps.ids.createId() as SecurityAuditEventId,
        eventType: SECURITY_AUDIT_EVENT_TYPES.USER_CREATED,
        occurredAt: this.deps.clock.now(),
        workspaceId: command.workspaceId,
        actorUserId: command.actorUserId,
        details: { purpose: "workspace_member_provision" },
      }),
    });

    if (workspace.organizationId !== undefined) {
      await this.ensureOrganizationMembership(
        workspace.organizationId,
        user.id,
      );
    }

    await this.addWorkspaceMembership({
      workspaceId: command.workspaceId,
      userId: user.id,
      role: command.role,
      actorUserId: command.actorUserId,
    });

    return user;
  }

  async changeNonOwnerWorkspaceMembershipRole(
    command: ScopedChangeWorkspaceMembershipRoleCommand,
  ): Promise<WorkspaceMembership> {
    rejectOwnerRoleForGenericMembershipRoute(command.role);
    const existing = await this.deps.workspaceMemberships.findById(
      command.membershipId,
    );
    if (existing === null) {
      throw new WorkspaceMembershipNotFoundError(command.membershipId);
    }
    requireMembershipInWorkspace(existing, command.workspaceId);
    rejectOwnerMembershipMutation(existing);

    return this.changeWorkspaceMembershipRole({
      membershipId: command.membershipId,
      role: command.role,
      actorUserId: command.actorUserId,
    });
  }

  async removeNonOwnerWorkspaceMembership(
    command: ScopedWorkspaceMembershipCommand,
  ): Promise<void> {
    const existing = await this.deps.workspaceMemberships.findById(
      command.membershipId,
    );
    if (existing === null) {
      throw new WorkspaceMembershipNotFoundError(command.membershipId);
    }
    requireMembershipInWorkspace(existing, command.workspaceId);
    rejectOwnerMembershipMutation(existing);

    await this.removeWorkspaceMembership({
      membershipId: command.membershipId,
      actorUserId: command.actorUserId,
    });
  }

  async grantWorkspaceOwnership(
    command: ScopedWorkspaceMembershipCommand,
  ): Promise<WorkspaceMembership> {
    await requireWorkspaceOwnerActor(
      this.deps.workspaceMemberships,
      command.workspaceId,
      command.actorUserId,
    );

    const existing = await this.deps.workspaceMemberships.findById(
      command.membershipId,
    );
    if (existing === null) {
      throw new WorkspaceMembershipNotFoundError(command.membershipId);
    }
    requireMembershipInWorkspace(existing, command.workspaceId);

    if (existing.role === HUMAN_WORKSPACE_ROLES.OWNER) {
      throw new DomainInvariantError("Membership is already OWNER.");
    }

    return this.changeWorkspaceMembershipRole({
      membershipId: command.membershipId,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
      actorUserId: command.actorUserId,
    });
  }

  private async assertUserEligibleForWorkspace(
    userId: UserId,
    workspaceId: WorkspaceId,
  ): Promise<void> {
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(workspaceId);
    }

    const user = await this.deps.users.findById(userId);
    if (user === null) {
      throw new UserNotFoundError(userId);
    }

    if (workspace.organizationId === undefined) {
      return;
    }

    if (this.deps.organizationMemberships === undefined) {
      throw new PermissionDeniedError();
    }

    const organizationMembership =
      await this.deps.organizationMemberships.findByOrganizationAndUser(
        workspace.organizationId,
        userId,
      );
    if (organizationMembership === null) {
      throw new PermissionDeniedError();
    }
  }

  private async ensureOrganizationMembership(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<void> {
    if (this.deps.organizationMemberships === undefined) {
      throw new PermissionDeniedError();
    }

    const existing =
      await this.deps.organizationMemberships.findByOrganizationAndUser(
        organizationId,
        userId,
      );
    if (existing !== null) {
      return;
    }

    await this.deps.organizationMemberships.save(
      OrganizationMembership.create({
        id: this.deps.ids.createId() as OrganizationMembershipId,
        organizationId,
        userId,
        role: ORGANIZATION_MEMBERSHIP_ROLES.MEMBER,
        createdAt: this.deps.clock.now(),
      }),
    );
  }
}
