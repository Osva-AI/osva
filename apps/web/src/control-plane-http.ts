import type { AuthorizationAction } from "@osva-ai/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva-ai/contracts";
import {
  isApiKeyRequestPrincipal,
  isHumanSessionRequestPrincipal,
  isSystemRequestPrincipal,
} from "@osva-ai/contracts";
import { emitSecurityEvent, SECURITY_EVENT_NAMES } from "@osva/observability";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "@osva/domain";
import type { WorkspaceId } from "@osva-ai/contracts";

import {
  getRequestPrincipal,
  resolveRequestId,
} from "./security-request-context.js";

function workspaceIdForScope(scope: ControlPlaneScope): WorkspaceId {
  const principal = scope.principal;
  if (isHumanSessionRequestPrincipal(principal)) {
    if (principal.workspaceId === undefined) {
      throw new PermissionDeniedError();
    }
    return principal.workspaceId;
  }
  return principal.workspaceId;
}

export function requireControlPlaneWorkspaceId(): WorkspaceId {
  return workspaceIdForScope(requireControlPlaneScope());
}

export function controlPlaneAuditActor(scope: ControlPlaneScope): {
  readonly workspaceId: WorkspaceId;
  readonly subjectId: string;
  readonly role: string | undefined;
} {
  const workspaceId = workspaceIdForScope(scope);
  const principal = scope.principal;
  if (isHumanSessionRequestPrincipal(principal)) {
    return {
      workspaceId,
      subjectId: principal.userId,
      role: principal.humanRole,
    };
  }
  return {
    workspaceId,
    subjectId: principal.subjectId,
    role: principal.role,
  };
}

export function requireControlPlaneScope(): ControlPlaneScope {
  const principal = getRequestPrincipal();
  if (principal === undefined) {
    throw new AuthenticationRequiredError();
  }
  if (
    isApiKeyRequestPrincipal(principal) ||
    isSystemRequestPrincipal(principal) ||
    isHumanSessionRequestPrincipal(principal)
  ) {
    return { principal };
  }
  throw new AuthenticationRequiredError();
}

function invokeControlPlaneAuthorization(
  scope: ControlPlaneScope,
  action: AuthorizationAction,
  resourceKind: string,
): void {
  try {
    requireControlPlaneAuthorization(scope, action, { kind: resourceKind });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      const principal = scope.principal;
      emitSecurityEvent({
        event: SECURITY_EVENT_NAMES.AUTH_AUTHORIZATION_DENIED,
        requestId: resolveRequestId(),
        workspaceId: isHumanSessionRequestPrincipal(principal)
          ? principal.workspaceId
          : principal.workspaceId,
        subjectId: isHumanSessionRequestPrincipal(principal)
          ? principal.userId
          : principal.subjectId,
        role: isHumanSessionRequestPrincipal(principal)
          ? principal.humanRole
          : principal.role,
        action,
        resourceType: resourceKind,
        outcome: "DENIED",
      });
    }
    throw error;
  }
}

export function authorizeControlPlaneRead(
  scope: ControlPlaneScope,
  resourceKind: string,
): void {
  invokeControlPlaneAuthorization(
    scope,
    AUTHORIZATION_ACTIONS.READ,
    resourceKind,
  );
}

export function authorizeControlPlaneWrite(
  scope: ControlPlaneScope,
  resourceKind: string,
): void {
  invokeControlPlaneAuthorization(
    scope,
    AUTHORIZATION_ACTIONS.WRITE,
    resourceKind,
  );
}

export function authorizeControlPlaneExecute(
  scope: ControlPlaneScope,
  resourceKind: string,
): void {
  invokeControlPlaneAuthorization(
    scope,
    AUTHORIZATION_ACTIONS.EXECUTE,
    resourceKind,
  );
}

export function authorizeControlPlaneAdmin(
  scope: ControlPlaneScope,
  resourceKind: string,
): void {
  invokeControlPlaneAuthorization(
    scope,
    AUTHORIZATION_ACTIONS.ADMIN,
    resourceKind,
  );
}

export function authorizeControlPlane(
  scope: ControlPlaneScope,
  action: AuthorizationAction,
  resourceKind: string,
): void {
  invokeControlPlaneAuthorization(scope, action, resourceKind);
}
