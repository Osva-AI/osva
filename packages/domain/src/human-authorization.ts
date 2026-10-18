import type {
  HumanAuthRouteId,
  HumanSessionRequestPrincipal,
  HumanWorkspacePermission,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  HUMAN_ROUTE_PERMISSIONS,
  humanAuthRouteRequiresWorkspace,
  humanWorkspaceRolePermitsPermission,
  isHumanSessionRequestPrincipal,
  type RequestPrincipal,
} from "@osva-ai/contracts";

import { PermissionDeniedError } from "./security-errors.js";
import {
  resolveWorkspaceAccess,
  type WorkspaceAccessResolverDependencies,
} from "./resolve-workspace-access.js";

export class WorkspaceSelectionRequiredError extends Error {
  constructor() {
    super("Workspace selection is required for this human route.");
    this.name = "WorkspaceSelectionRequiredError";
  }
}

export interface HumanRouteAuthorizationContext {
  readonly principal: HumanSessionRequestPrincipal;
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly permission: HumanWorkspacePermission;
}

export async function authorizeHumanRoute(
  deps: WorkspaceAccessResolverDependencies,
  input: {
    readonly principal: RequestPrincipal | undefined;
    readonly routeId: HumanAuthRouteId;
    readonly workspaceId?: WorkspaceId;
  },
): Promise<HumanRouteAuthorizationContext | undefined> {
  const requiredPermission = HUMAN_ROUTE_PERMISSIONS[input.routeId];
  if (requiredPermission === null) {
    return undefined;
  }

  if (
    input.principal === undefined ||
    !isHumanSessionRequestPrincipal(input.principal)
  ) {
    throw new PermissionDeniedError();
  }

  if (!humanAuthRouteRequiresWorkspace(input.routeId)) {
    throw new PermissionDeniedError();
  }

  const workspaceId =
    input.workspaceId ?? input.principal.workspaceId ?? undefined;
  if (workspaceId === undefined) {
    throw new WorkspaceSelectionRequiredError();
  }

  const access = await resolveWorkspaceAccess(deps, {
    userId: input.principal.userId,
    workspaceId,
  });
  if (access === undefined) {
    throw new PermissionDeniedError();
  }

  if (!humanWorkspaceRolePermitsPermission(access.role, requiredPermission)) {
    throw new PermissionDeniedError();
  }

  return {
    principal: {
      ...input.principal,
      workspaceId,
      humanRole: access.role,
    },
    workspaceId,
    userId: input.principal.userId,
    permission: requiredPermission,
  };
}
