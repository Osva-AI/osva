import type {
  ApiKeyId,
  AuthorizationAction,
  RequestPrincipal,
  WorkspaceId,
} from "@osva/contracts";
import {
  AUTHENTICATION_METHODS,
  COMMUNITY_EDITION_ROLES,
} from "@osva/contracts";

import {
  authorize,
  type AuthorizationContext,
  type AuthorizationResource,
} from "./authorization.js";

export interface ControlPlaneScope {
  readonly principal: RequestPrincipal;
}

export function controlPlaneWorkspaceId(scope: ControlPlaneScope): WorkspaceId {
  return scope.principal.workspaceId;
}

/** Internal/runtime callers that already enforce workspace via execution identity. */
export function runtimeControlPlaneScope(
  workspaceId: WorkspaceId,
): ControlPlaneScope {
  return {
    principal: {
      subjectId: "runtime-internal" as ApiKeyId,
      workspaceId,
      role: COMMUNITY_EDITION_ROLES.ADMIN,
      authenticationMethod: AUTHENTICATION_METHODS.API_KEY,
    },
  };
}

export function requireControlPlaneAuthorization(
  scope: ControlPlaneScope,
  action: AuthorizationAction,
  resource: AuthorizationResource,
): void {
  const context: AuthorizationContext = {
    workspaceId: scope.principal.workspaceId,
  };
  authorize(scope.principal, action, resource, context);
}
