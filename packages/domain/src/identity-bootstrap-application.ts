import type {
  OrganizationId,
  SecurityAuditEventId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  HUMAN_WORKSPACE_ROLES,
  ORGANIZATION_MEMBERSHIP_ROLES,
  SECURITY_AUDIT_EVENT_TYPES,
  USER_STATUSES,
} from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import { SecurityAuditEvent } from "./security-audit-event.js";
import { User } from "./user.js";
import { WorkspaceMembership } from "./workspace-membership.js";
import type { IdentityLifecycleRepository } from "./ports/identity-lifecycle-repository.js";
import type { OrganizationRepository } from "./ports/organization-repository.js";
import type { SecurityAuditEventRepository } from "./ports/security-audit-event-repository.js";
import type { UserRepository } from "./ports/user-repository.js";
import type { WorkspaceMembershipRepository } from "./ports/workspace-membership-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";
import { Organization } from "./organization.js";
import { OrganizationMembership } from "./organization-membership.js";

export interface IdentityBootstrapApplicationClock {
  now(): Date;
}

export interface IdentityBootstrapApplicationIds {
  createId(): string;
}

export interface IdentityBootstrapApplicationDependencies {
  readonly organizations: OrganizationRepository;
  readonly users: UserRepository;
  readonly workspaces: WorkspaceRepository;
  readonly workspaceMemberships: WorkspaceMembershipRepository;
  readonly lifecycle: IdentityLifecycleRepository;
  readonly securityAuditEvents: SecurityAuditEventRepository;
  readonly clock: IdentityBootstrapApplicationClock;
  readonly ids: IdentityBootstrapApplicationIds;
}

export interface IdentityBootstrapCommand {
  readonly organizationName: string;
  readonly ownerEmail: string;
  readonly ownerDisplayName: string;
  readonly workspaceIds: readonly WorkspaceId[];
  readonly allUnlinkedWorkspaces: boolean;
}

export interface IdentityBootstrapResult {
  readonly organizationId: OrganizationId;
  readonly ownerUserId: UserId;
  readonly linkedWorkspaceIds: readonly WorkspaceId[];
}

export class IdentityBootstrapApplication {
  constructor(
    private readonly deps: IdentityBootstrapApplicationDependencies,
  ) {}

  async bootstrapExistingInstallation(
    command: IdentityBootstrapCommand,
  ): Promise<IdentityBootstrapResult> {
    const workspaceIds = command.allUnlinkedWorkspaces
      ? await this.deps.workspaces.listUnlinkedIds()
      : [...command.workspaceIds];
    if (workspaceIds.length === 0) {
      throw new DomainInvariantError(
        "Identity bootstrap requires at least one explicitly selected unlinked workspace.",
      );
    }

    for (const workspaceId of workspaceIds) {
      const workspace = await this.deps.workspaces.findById(workspaceId);
      if (workspace === null) {
        throw new DomainInvariantError(`Workspace not found: ${workspaceId}`);
      }
      if (workspace.organizationId !== undefined) {
        throw new DomainInvariantError(
          `Workspace ${workspaceId} is already linked to an organization.`,
        );
      }
    }

    const owner = User.create({
      id: this.deps.ids.createId() as UserId,
      email: command.ownerEmail,
      displayName: command.ownerDisplayName,
      status: USER_STATUSES.PENDING_SETUP,
      createdAt: this.deps.clock.now(),
    });

    const organization = Organization.create({
      id: this.deps.ids.createId() as OrganizationId,
      name: command.organizationName,
      createdAt: this.deps.clock.now(),
    });

    const ownerOrganizationMembership = OrganizationMembership.create({
      id: this.deps.ids.createId() as import("@osva-ai/contracts").OrganizationMembershipId,
      organizationId: organization.id,
      userId: owner.id,
      role: ORGANIZATION_MEMBERSHIP_ROLES.OWNER,
      createdAt: this.deps.clock.now(),
    });

    await this.deps.lifecycle.registerUser({
      user: owner,
      auditEvent: SecurityAuditEvent.create({
        id: this.deps.ids.createId() as SecurityAuditEventId,
        eventType: SECURITY_AUDIT_EVENT_TYPES.USER_CREATED,
        occurredAt: this.deps.clock.now(),
        actorUserId: owner.id,
        details: { source: "identity_bootstrap" },
      }),
    });

    await this.deps.lifecycle.createOrganizationWithOwner({
      organization,
      ownerMembership: ownerOrganizationMembership,
      auditEvent: SecurityAuditEvent.create({
        id: this.deps.ids.createId() as SecurityAuditEventId,
        eventType: SECURITY_AUDIT_EVENT_TYPES.ORGANIZATION_CREATED,
        occurredAt: this.deps.clock.now(),
        organizationId: organization.id,
        actorUserId: owner.id,
        details: { source: "identity_bootstrap" },
      }),
    });

    for (const workspaceId of workspaceIds) {
      const workspace = await this.deps.workspaces.findById(workspaceId);
      if (workspace === null) {
        continue;
      }

      const linked = workspace.withOrganizationId(organization.id);
      await this.deps.workspaces.save(linked);

      const membership = WorkspaceMembership.create({
        id: this.deps.ids.createId() as import("@osva-ai/contracts").WorkspaceMembershipId,
        workspaceId,
        userId: owner.id,
        role: HUMAN_WORKSPACE_ROLES.OWNER,
        createdAt: this.deps.clock.now(),
      });

      await this.deps.lifecycle.createWorkspaceMembership({
        workspaceId,
        membership,
        auditEvent: SecurityAuditEvent.create({
          id: this.deps.ids.createId() as SecurityAuditEventId,
          eventType: SECURITY_AUDIT_EVENT_TYPES.WORKSPACE_MEMBERSHIP_CREATED,
          occurredAt: this.deps.clock.now(),
          workspaceId,
          actorUserId: owner.id,
          details: {
            userId: owner.id,
            role: HUMAN_WORKSPACE_ROLES.OWNER,
            source: "identity_bootstrap",
          },
        }),
      });
    }

    await this.deps.securityAuditEvents.append(
      SecurityAuditEvent.create({
        id: this.deps.ids.createId() as SecurityAuditEventId,
        eventType: SECURITY_AUDIT_EVENT_TYPES.IDENTITY_BOOTSTRAP_COMPLETED,
        occurredAt: this.deps.clock.now(),
        organizationId: organization.id,
        actorUserId: owner.id,
        details: {
          linkedWorkspaceCount: workspaceIds.length,
        },
      }),
    );

    return {
      organizationId: organization.id,
      ownerUserId: owner.id,
      linkedWorkspaceIds: workspaceIds,
    };
  }
}
