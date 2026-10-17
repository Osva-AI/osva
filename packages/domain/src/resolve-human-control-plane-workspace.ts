import type { UserId, WorkspaceId } from "@osva-ai/contracts";

import { WorkspaceSelectionRequiredError } from "./human-authorization.js";
import {
  resolveWorkspaceAccess,
  type ResolvedWorkspaceAccess,
  type WorkspaceAccessResolverDependencies,
} from "./resolve-workspace-access.js";
import { PermissionDeniedError } from "./security-errors.js";

export async function resolveHumanControlPlaneWorkspace(
  deps: WorkspaceAccessResolverDependencies,
  input: {
    readonly userId: UserId;
    readonly workspaceSelector?: WorkspaceId;
  },
): Promise<ResolvedWorkspaceAccess> {
  if (input.workspaceSelector !== undefined) {
    const resolved = await resolveWorkspaceAccess(deps, {
      userId: input.userId,
      workspaceId: input.workspaceSelector,
    });
    if (resolved === undefined) {
      throw new PermissionDeniedError();
    }
    return resolved;
  }

  const memberships = await deps.workspaceMemberships.listByUserId(
    input.userId,
  );
  if (memberships.length === 0) {
    throw new PermissionDeniedError();
  }
  if (memberships.length === 1) {
    const only = memberships[0];
    if (only === undefined) {
      throw new PermissionDeniedError();
    }
    const resolved = await resolveWorkspaceAccess(deps, {
      userId: input.userId,
      workspaceId: only.workspaceId,
    });
    if (resolved === undefined) {
      throw new PermissionDeniedError();
    }
    return resolved;
  }

  throw new WorkspaceSelectionRequiredError();
}
