import type { AuthorizationAction } from "@osva/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva/contracts";
import { emitSecurityEvent, SECURITY_EVENT_NAMES } from "@osva/observability";
import {
  PermissionDeniedError,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "@osva/domain";

import {
  requireRequestPrincipal,
  resolveRequestId,
} from "./security-request-context.js";

export function requireControlPlaneScope(): ControlPlaneScope {
  return { principal: requireRequestPrincipal() };
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
        workspaceId: principal.workspaceId,
        subjectId: principal.subjectId,
        role: principal.role,
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
