import type { UserId, WorkspaceId } from "@osva-ai/contracts";
import type { HumanWorkspaceRole } from "@osva-ai/contracts";
import { USER_STATUSES } from "@osva-ai/contracts";

import type { UserRepository } from "./ports/user-repository.js";
import type { WorkspaceMembershipRepository } from "./ports/workspace-membership-repository.js";

export interface ResolvedWorkspaceAccess {
  readonly userId: UserId;
  readonly workspaceId: WorkspaceId;
  readonly role: HumanWorkspaceRole;
}

export interface WorkspaceAccessResolverDependencies {
  readonly users: UserRepository;
  readonly workspaceMemberships: WorkspaceMembershipRepository;
}

export async function resolveWorkspaceAccess(
  deps: WorkspaceAccessResolverDependencies,
  input: { readonly userId: UserId; readonly workspaceId: WorkspaceId },
): Promise<ResolvedWorkspaceAccess | undefined> {
  const user = await deps.users.findById(input.userId);
  if (user === null || user.status !== USER_STATUSES.ACTIVE) {
    return undefined;
  }

  const membership = await deps.workspaceMemberships.findByWorkspaceAndUser(
    input.workspaceId,
    input.userId,
  );
  if (membership === null) {
    return undefined;
  }

  return {
    userId: input.userId,
    workspaceId: input.workspaceId,
    role: membership.role,
  };
}
