import type { AuthorizationAction } from "./security.js";
import { AUTHORIZATION_ACTIONS } from "./security.js";

export const HUMAN_WORKSPACE_ROLES = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  DEVELOPER: "DEVELOPER",
  OPERATOR: "OPERATOR",
  VIEWER: "VIEWER",
} as const;

export type HumanWorkspaceRole =
  (typeof HUMAN_WORKSPACE_ROLES)[keyof typeof HUMAN_WORKSPACE_ROLES];

export const HUMAN_WORKSPACE_PERMISSIONS = {
  ACCESS_WORKSPACE: "ACCESS_WORKSPACE",
  READ: "READ",
  EXECUTE: "EXECUTE",
  WRITE: "WRITE",
  ADMINISTER_WORKSPACE: "ADMINISTER_WORKSPACE",
  MANAGE_MEMBERS: "MANAGE_MEMBERS",
  TRANSFER_OWNERSHIP: "TRANSFER_OWNERSHIP",
} as const;

export type HumanWorkspacePermission =
  (typeof HUMAN_WORKSPACE_PERMISSIONS)[keyof typeof HUMAN_WORKSPACE_PERMISSIONS];

export const ORGANIZATION_MEMBERSHIP_ROLES = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
} as const;

export type OrganizationMembershipRole =
  (typeof ORGANIZATION_MEMBERSHIP_ROLES)[keyof typeof ORGANIZATION_MEMBERSHIP_ROLES];

export const USER_STATUSES = {
  PENDING_SETUP: "PENDING_SETUP",
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
} as const;

export type UserStatus = (typeof USER_STATUSES)[keyof typeof USER_STATUSES];

export const SECURITY_AUDIT_EVENT_TYPES = {
  ORGANIZATION_CREATED: "organization.created",
  USER_CREATED: "user.created",
  ORGANIZATION_MEMBERSHIP_CREATED: "organization_membership.created",
  WORKSPACE_MEMBERSHIP_CREATED: "workspace_membership.created",
  WORKSPACE_MEMBERSHIP_ROLE_CHANGED: "workspace_membership.role_changed",
  WORKSPACE_OWNERSHIP_TRANSFERRED: "workspace_membership.ownership_transferred",
  WORKSPACE_MEMBERSHIP_REMOVED: "workspace_membership.removed",
  USER_LOGIN_SUCCEEDED: "user.login_succeeded",
  USER_LOGIN_FAILED: "user.login_failed",
  USER_LOGOUT: "user.logout",
  USER_SETUP_COMPLETED: "user.setup_completed",
  USER_PASSWORD_RESET_REQUESTED: "user.password_reset_requested",
  USER_PASSWORD_RESET_COMPLETED: "user.password_reset_completed",
  USER_SESSION_REVOKED: "user.session_revoked",
  IDENTITY_BOOTSTRAP_COMPLETED: "identity.bootstrap_completed",
  IDENTITY_RECOVERY_COMPLETED: "identity.recovery_completed",
} as const;

export type SecurityAuditEventType =
  (typeof SECURITY_AUDIT_EVENT_TYPES)[keyof typeof SECURITY_AUDIT_EVENT_TYPES];

export const USER_EMAIL_MAX_LENGTH = 320;
export const USER_DISPLAY_NAME_MAX_LENGTH = 128;
export const ORGANIZATION_NAME_MAX_LENGTH = 128;

/** Maximum serialized JSON size for `SecurityAuditEvent.details` (4 KiB). */
export const SECURITY_AUDIT_EVENT_DETAILS_MAX_BYTES = 4_096;

const HUMAN_ROLE_PERMISSIONS: Readonly<
  Record<HumanWorkspaceRole, ReadonlySet<HumanWorkspacePermission>>
> = {
  [HUMAN_WORKSPACE_ROLES.VIEWER]: new Set<HumanWorkspacePermission>([
    HUMAN_WORKSPACE_PERMISSIONS.ACCESS_WORKSPACE,
    HUMAN_WORKSPACE_PERMISSIONS.READ,
  ]),
  [HUMAN_WORKSPACE_ROLES.OPERATOR]: new Set<HumanWorkspacePermission>([
    HUMAN_WORKSPACE_PERMISSIONS.ACCESS_WORKSPACE,
    HUMAN_WORKSPACE_PERMISSIONS.READ,
    HUMAN_WORKSPACE_PERMISSIONS.EXECUTE,
  ]),
  [HUMAN_WORKSPACE_ROLES.DEVELOPER]: new Set<HumanWorkspacePermission>([
    HUMAN_WORKSPACE_PERMISSIONS.ACCESS_WORKSPACE,
    HUMAN_WORKSPACE_PERMISSIONS.READ,
    HUMAN_WORKSPACE_PERMISSIONS.EXECUTE,
    HUMAN_WORKSPACE_PERMISSIONS.WRITE,
  ]),
  [HUMAN_WORKSPACE_ROLES.ADMIN]: new Set<HumanWorkspacePermission>([
    HUMAN_WORKSPACE_PERMISSIONS.ACCESS_WORKSPACE,
    HUMAN_WORKSPACE_PERMISSIONS.READ,
    HUMAN_WORKSPACE_PERMISSIONS.EXECUTE,
    HUMAN_WORKSPACE_PERMISSIONS.WRITE,
    HUMAN_WORKSPACE_PERMISSIONS.ADMINISTER_WORKSPACE,
    HUMAN_WORKSPACE_PERMISSIONS.MANAGE_MEMBERS,
  ]),
  [HUMAN_WORKSPACE_ROLES.OWNER]: new Set<HumanWorkspacePermission>([
    HUMAN_WORKSPACE_PERMISSIONS.ACCESS_WORKSPACE,
    HUMAN_WORKSPACE_PERMISSIONS.READ,
    HUMAN_WORKSPACE_PERMISSIONS.EXECUTE,
    HUMAN_WORKSPACE_PERMISSIONS.WRITE,
    HUMAN_WORKSPACE_PERMISSIONS.ADMINISTER_WORKSPACE,
    HUMAN_WORKSPACE_PERMISSIONS.MANAGE_MEMBERS,
    HUMAN_WORKSPACE_PERMISSIONS.TRANSFER_OWNERSHIP,
  ]),
};

const HUMAN_ROLE_AUTHORIZATION_ACTIONS: Readonly<
  Record<HumanWorkspaceRole, ReadonlySet<AuthorizationAction>>
> = {
  [HUMAN_WORKSPACE_ROLES.VIEWER]: new Set<AuthorizationAction>([
    AUTHORIZATION_ACTIONS.READ,
  ]),
  [HUMAN_WORKSPACE_ROLES.OPERATOR]: new Set<AuthorizationAction>([
    AUTHORIZATION_ACTIONS.READ,
    AUTHORIZATION_ACTIONS.EXECUTE,
  ]),
  [HUMAN_WORKSPACE_ROLES.DEVELOPER]: new Set<AuthorizationAction>([
    AUTHORIZATION_ACTIONS.READ,
    AUTHORIZATION_ACTIONS.EXECUTE,
    AUTHORIZATION_ACTIONS.WRITE,
  ]),
  [HUMAN_WORKSPACE_ROLES.ADMIN]: new Set<AuthorizationAction>([
    AUTHORIZATION_ACTIONS.READ,
    AUTHORIZATION_ACTIONS.EXECUTE,
    AUTHORIZATION_ACTIONS.WRITE,
    AUTHORIZATION_ACTIONS.ADMIN,
  ]),
  [HUMAN_WORKSPACE_ROLES.OWNER]: new Set<AuthorizationAction>([
    AUTHORIZATION_ACTIONS.READ,
    AUTHORIZATION_ACTIONS.EXECUTE,
    AUTHORIZATION_ACTIONS.WRITE,
    AUTHORIZATION_ACTIONS.ADMIN,
  ]),
};

export function humanWorkspaceRolePermitsPermission(
  role: HumanWorkspaceRole,
  permission: HumanWorkspacePermission,
): boolean {
  return HUMAN_ROLE_PERMISSIONS[role].has(permission);
}

export function humanWorkspaceRolePermitsAuthorizationAction(
  role: HumanWorkspaceRole,
  action: AuthorizationAction,
): boolean {
  return HUMAN_ROLE_AUTHORIZATION_ACTIONS[role].has(action);
}

export function normalizeUserEmail(email: string): string {
  return email.trim().toLowerCase();
}
