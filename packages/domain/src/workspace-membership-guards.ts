import type { WorkspaceId } from "@osva-ai/contracts";
import {
  HUMAN_WORKSPACE_ROLES,
  type HumanWorkspaceRole,
} from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import { PermissionDeniedError } from "./security-errors.js";
import type { WorkspaceMembership } from "./workspace-membership.js";

export function rejectOwnerRoleForGenericMembershipRoute(
  role: HumanWorkspaceRole,
): void {
  if (role === HUMAN_WORKSPACE_ROLES.OWNER) {
    throw new DomainInvariantError(
      "OWNER role cannot be assigned through generic membership routes.",
    );
  }
}

export function requireMembershipInWorkspace(
  membership: WorkspaceMembership,
  workspaceId: WorkspaceId,
): void {
  if (membership.workspaceId !== workspaceId) {
    throw new PermissionDeniedError();
  }
}

export function rejectOwnerMembershipMutation(
  membership: WorkspaceMembership,
): void {
  if (membership.role === HUMAN_WORKSPACE_ROLES.OWNER) {
    throw new PermissionDeniedError();
  }
}
