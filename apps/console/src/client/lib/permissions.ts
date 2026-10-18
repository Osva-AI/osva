import {
  AUTHORIZATION_ACTIONS,
  HUMAN_WORKSPACE_PERMISSIONS,
  type AuthorizationAction,
  type HumanWorkspaceRole,
  humanWorkspaceRolePermitsAuthorizationAction,
  humanWorkspaceRolePermitsPermission,
  type HumanWorkspacePermission,
} from "@osva-ai/contracts";

export function rolePermitsAuthorizationAction(
  role: string,
  action: AuthorizationAction,
): boolean {
  return humanWorkspaceRolePermitsAuthorizationAction(
    role as HumanWorkspaceRole,
    action,
  );
}

export function rolePermitsHumanPermission(
  role: string,
  permission: HumanWorkspacePermission,
): boolean {
  return humanWorkspaceRolePermitsPermission(
    role as HumanWorkspaceRole,
    permission,
  );
}

export function roleCanExecuteControlPlaneActions(role: string): boolean {
  return rolePermitsAuthorizationAction(role, AUTHORIZATION_ACTIONS.EXECUTE);
}

export function roleCanWriteControlPlaneResources(role: string): boolean {
  return rolePermitsAuthorizationAction(role, AUTHORIZATION_ACTIONS.WRITE);
}

export function roleCanManageMembers(role: string): boolean {
  return rolePermitsHumanPermission(
    role,
    HUMAN_WORKSPACE_PERMISSIONS.MANAGE_MEMBERS,
  );
}

export function roleCanReadAuditEvents(role: string): boolean {
  return rolePermitsHumanPermission(role, HUMAN_WORKSPACE_PERMISSIONS.READ);
}

export function roleCanTransferOwnership(role: string): boolean {
  return rolePermitsHumanPermission(
    role,
    HUMAN_WORKSPACE_PERMISSIONS.TRANSFER_OWNERSHIP,
  );
}
