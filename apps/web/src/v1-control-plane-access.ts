import type { IncomingMessage } from "node:http";

import {
  humanWorkspaceRolePermitsPermission,
  isHumanSessionRequestPrincipal,
  OSVA_WORKSPACE_ID_HEADER,
  type HumanSessionRequestPrincipal,
  type WorkspaceId,
  V1_ROUTE_ACCESS_CLASSES,
} from "@osva-ai/contracts";
import {
  PermissionDeniedError,
  resolveHumanControlPlaneWorkspace,
  WorkspaceSelectionRequiredError,
} from "@osva/domain";

import type { HumanAuthHttpServices } from "./human-auth-http.js";
import { lookupV1RouteAccess } from "./v1-route-human-access-inventory.js";

function readWorkspaceSelector(
  request: IncomingMessage,
  principal: HumanSessionRequestPrincipal,
): WorkspaceId | undefined {
  const raw = request.headers[OSVA_WORKSPACE_ID_HEADER.toLowerCase()];
  if (typeof raw === "string" && raw.length > 0) {
    return raw as WorkspaceId;
  }
  return principal.workspaceId;
}

/**
 * Resolves workspace membership and route permission for a human principal on
 * `/v1` control-plane paths. Returns an enriched principal for handler scope.
 */
export async function authorizeHumanControlPlaneRequest(
  request: IncomingMessage,
  method: string,
  pathname: string,
  services: HumanAuthHttpServices,
  principal: HumanSessionRequestPrincipal,
): Promise<HumanSessionRequestPrincipal> {
  const access = lookupV1RouteAccess(method, pathname);
  if (access === undefined) {
    throw new PermissionDeniedError();
  }

  switch (access.accessClass) {
    case V1_ROUTE_ACCESS_CLASSES.API_KEY_ONLY:
    case V1_ROUTE_ACCESS_CLASSES.HUMAN_PRINCIPAL_DENIED:
    case V1_ROUTE_ACCESS_CLASSES.PUBLIC_AUTHENTICATION:
    case V1_ROUTE_ACCESS_CLASSES.HUMAN_IDENTITY_SESSION:
    case V1_ROUTE_ACCESS_CLASSES.HUMAN_IDENTITY_WORKSPACE:
      throw new PermissionDeniedError();
    case V1_ROUTE_ACCESS_CLASSES.CONTROL_PLANE_WORKSPACE:
      break;
  }

  const permission = access.requiredHumanPermission;
  if (permission === null) {
    throw new PermissionDeniedError();
  }

  const resolved = await resolveHumanControlPlaneWorkspace(
    {
      users: services.users,
      workspaceMemberships: services.workspaceMemberships,
    },
    {
      userId: principal.userId,
      workspaceSelector: readWorkspaceSelector(request, principal),
    },
  );

  if (!humanWorkspaceRolePermitsPermission(resolved.role, permission)) {
    throw new PermissionDeniedError();
  }

  return {
    ...principal,
    workspaceId: resolved.workspaceId,
    humanRole: resolved.role,
  };
}

export function isHumanSessionPrincipal(
  principal: unknown,
): principal is HumanSessionRequestPrincipal {
  return (
    typeof principal === "object" &&
    principal !== null &&
    isHumanSessionRequestPrincipal(principal as HumanSessionRequestPrincipal)
  );
}

export { PermissionDeniedError, WorkspaceSelectionRequiredError };
