import type {
  OrganizationId,
  OrganizationMembershipId,
  SecurityAuditEventId,
  UserId,
  WorkspaceId,
  WorkspaceMembershipId,
} from "@osva-ai/contracts";
import type {
  HumanWorkspaceRole,
  OrganizationMembershipRole,
  SecurityAuditEventType,
  UserStatus,
} from "@osva-ai/contracts";
import {
  Organization,
  OrganizationMembership,
  SecurityAuditEvent,
  User,
  WorkspaceMembership,
} from "@osva/domain";

import type { organizationMemberships } from "../schema/organization-memberships.js";
import type { organizations } from "../schema/organizations.js";
import type { securityAuditEvents } from "../schema/security-audit-events.js";
import type { users } from "../schema/users.js";
import type { workspaceMemberships } from "../schema/workspace-memberships.js";
import { toDomainDate } from "./timestamps.js";

type OrganizationRow = typeof organizations.$inferSelect;
type UserRow = typeof users.$inferSelect;
type OrganizationMembershipRow = typeof organizationMemberships.$inferSelect;
type WorkspaceMembershipRow = typeof workspaceMemberships.$inferSelect;
type SecurityAuditEventRow = typeof securityAuditEvents.$inferSelect;

export function organizationToRow(organization: Organization) {
  return {
    id: organization.id,
    name: organization.name,
    createdAt: organization.createdAt,
  };
}

export function organizationFromRow(row: OrganizationRow): Organization {
  return Organization.create({
    id: row.id as OrganizationId,
    name: row.name,
    createdAt: toDomainDate(row.createdAt),
  });
}

export function userToRow(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    emailVerified: false,
    createdAt: user.createdAt,
    updatedAt: user.createdAt,
  };
}

export function userFromRow(row: UserRow): User {
  return User.create({
    id: row.id as UserId,
    email: row.email,
    displayName: row.displayName,
    status: row.status as UserStatus,
    createdAt: toDomainDate(row.createdAt),
  });
}

export function organizationMembershipToRow(
  membership: OrganizationMembership,
) {
  return {
    id: membership.id,
    organizationId: membership.organizationId,
    userId: membership.userId,
    role: membership.role,
    createdAt: membership.createdAt,
  };
}

export function organizationMembershipFromRow(
  row: OrganizationMembershipRow,
): OrganizationMembership {
  return OrganizationMembership.create({
    id: row.id as OrganizationMembershipId,
    organizationId: row.organizationId as OrganizationId,
    userId: row.userId as UserId,
    role: row.role as OrganizationMembershipRole,
    createdAt: toDomainDate(row.createdAt),
  });
}

export function workspaceMembershipToRow(membership: WorkspaceMembership) {
  return {
    id: membership.id,
    workspaceId: membership.workspaceId,
    userId: membership.userId,
    role: membership.role,
    createdAt: membership.createdAt,
  };
}

export function workspaceMembershipFromRow(
  row: WorkspaceMembershipRow,
): WorkspaceMembership {
  return WorkspaceMembership.create({
    id: row.id as WorkspaceMembershipId,
    workspaceId: row.workspaceId as WorkspaceId,
    userId: row.userId as UserId,
    role: row.role as HumanWorkspaceRole,
    createdAt: toDomainDate(row.createdAt),
  });
}

export function securityAuditEventToRow(event: SecurityAuditEvent) {
  return {
    id: event.id,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    organizationId: event.organizationId ?? null,
    workspaceId: event.workspaceId ?? null,
    actorUserId: event.actorUserId ?? null,
    details: event.details,
  };
}

export function securityAuditEventFromRow(
  row: SecurityAuditEventRow,
): SecurityAuditEvent {
  return SecurityAuditEvent.create({
    id: row.id as SecurityAuditEventId,
    eventType: row.eventType as SecurityAuditEventType,
    occurredAt: toDomainDate(row.occurredAt),
    organizationId:
      row.organizationId === null
        ? undefined
        : (row.organizationId as OrganizationId),
    workspaceId:
      row.workspaceId === null ? undefined : (row.workspaceId as WorkspaceId),
    actorUserId:
      row.actorUserId === null ? undefined : (row.actorUserId as UserId),
    details:
      typeof row.details === "object" && row.details !== null
        ? (row.details as SecurityAuditEvent["details"])
        : {},
  });
}
