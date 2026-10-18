import type {
  HumanWorkspaceRole,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { HUMAN_WORKSPACE_ROLES } from "@osva-ai/contracts";

import { PermissionDeniedError } from "./security-errors.js";
import type { WorkspaceMembershipRepository } from "./ports/workspace-membership-repository.js";

export async function requireWorkspaceOwnerActor(
  workspaceMemberships: WorkspaceMembershipRepository,
  workspaceId: WorkspaceId,
  actorUserId: UserId | undefined,
): Promise<void> {
  if (actorUserId === undefined) {
    throw new PermissionDeniedError();
  }

  const actorMembership = await workspaceMemberships.findByWorkspaceAndUser(
    workspaceId,
    actorUserId,
  );
  if (
    actorMembership === null ||
    actorMembership.role !== HUMAN_WORKSPACE_ROLES.OWNER
  ) {
    throw new PermissionDeniedError();
  }
}

export function roleChangeTouchesOwner(
  previousRole: HumanWorkspaceRole,
  nextRole: HumanWorkspaceRole,
): boolean {
  return (
    previousRole === HUMAN_WORKSPACE_ROLES.OWNER ||
    nextRole === HUMAN_WORKSPACE_ROLES.OWNER
  );
}
