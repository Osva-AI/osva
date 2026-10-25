import type {
  ApiKeyId,
  ApiKeyRequestPrincipal,
  AuthorizationAction,
  HumanSessionRequestPrincipal,
  SystemRequestPrincipal,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  AUTHENTICATION_METHODS,
  COMMUNITY_EDITION_ROLES,
  humanWorkspaceRolePermitsAuthorizationAction,
  isApiKeyRequestPrincipal,
  isHumanSessionRequestPrincipal,
  isSystemRequestPrincipal,
} from "@osva-ai/contracts";

import {
  authorizeApiKeyPrincipal,
  type AuthorizationContext,
  type AuthorizationResource,
} from "./authorization.js";
import { PermissionDeniedError } from "./security-errors.js";

export type ControlPlanePrincipal =
  | ApiKeyRequestPrincipal
  | SystemRequestPrincipal
  | HumanSessionRequestPrincipal;

export interface ControlPlaneScope {
  readonly principal: ControlPlanePrincipal;
}

function asApiKeyAuthorizationPrincipal(
  principal: ControlPlanePrincipal,
): ApiKeyRequestPrincipal {
  if (isApiKeyRequestPrincipal(principal)) {
    return principal;
  }
  if (isSystemRequestPrincipal(principal)) {
    return {
      authenticationMethod: AUTHENTICATION_METHODS.API_KEY,
      subjectId: principal.subjectId as ApiKeyId,
      workspaceId: principal.workspaceId,
      role: principal.role,
    };
  }
  throw new Error(
    "Control plane scope requires an API key or system principal.",
  );
}

export function controlPlaneWorkspaceId(scope: ControlPlaneScope): WorkspaceId {
  if (isHumanSessionRequestPrincipal(scope.principal)) {
    if (scope.principal.workspaceId === undefined) {
      throw new PermissionDeniedError();
    }
    return scope.principal.workspaceId;
  }
  return asApiKeyAuthorizationPrincipal(scope.principal).workspaceId;
}

/** Internal/runtime callers that already enforce workspace via execution identity. */
export function runtimeControlPlaneScope(
  workspaceId: WorkspaceId,
): ControlPlaneScope {
  return {
    principal: {
      authenticationMethod: AUTHENTICATION_METHODS.SYSTEM,
      subjectId: "runtime-internal",
      workspaceId,
      role: COMMUNITY_EDITION_ROLES.ADMIN,
    },
  };
}

export function requireControlPlaneAuthorization(
  scope: ControlPlaneScope,
  action: AuthorizationAction,
  resource: AuthorizationResource,
): void {
  const workspaceId = controlPlaneWorkspaceId(scope);
  const context: AuthorizationContext = { workspaceId };

  if (isHumanSessionRequestPrincipal(scope.principal)) {
    const human = scope.principal;
    if (
      human.humanRole === undefined ||
      human.workspaceId === undefined ||
      human.workspaceId !== workspaceId
    ) {
      throw new PermissionDeniedError();
    }
    if (
      !humanWorkspaceRolePermitsAuthorizationAction(human.humanRole, action)
    ) {
      throw new PermissionDeniedError();
    }
    return;
  }

  const principal = asApiKeyAuthorizationPrincipal(scope.principal);
  authorizeApiKeyPrincipal(principal, action, resource, context);
}

export function controlPlaneAuditActor(scope: ControlPlaneScope): {
  readonly workspaceId: WorkspaceId;
  readonly subjectId: string;
  readonly actorUserId: UserId | undefined;
} {
  const workspaceId = controlPlaneWorkspaceId(scope);
  const principal = scope.principal;
  if (isHumanSessionRequestPrincipal(principal)) {
    return {
      workspaceId,
      subjectId: principal.userId,
      actorUserId: principal.userId,
    };
  }
  return {
    workspaceId,
    subjectId: principal.subjectId,
    actorUserId: undefined,
  };
}
