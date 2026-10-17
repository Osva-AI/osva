import type { HumanWorkspacePermission } from "./human-identity.js";
import { HUMAN_WORKSPACE_PERMISSIONS } from "./human-identity.js";
import type { AuthorizationAction } from "./security.js";
import { AUTHORIZATION_ACTIONS } from "./security.js";

/** How a `/v1` route participates in human session authorization. */
export const V1_ROUTE_ACCESS_CLASSES = {
  /** Login, setup, recovery — no session required. */
  PUBLIC_AUTHENTICATION: "public_authentication",
  /** Human session routes without workspace-scoped control-plane permissions. */
  HUMAN_IDENTITY_SESSION: "human_identity_session",
  /** Human identity admin routes requiring workspace membership permissions. */
  HUMAN_IDENTITY_WORKSPACE: "human_identity_workspace",
  /** Standard control-plane route; humans use workspace membership + permission. */
  CONTROL_PLANE_WORKSPACE: "control_plane_workspace",
  /** Machine API-key context only (e.g. GET /v1/auth/context). */
  API_KEY_ONLY: "api_key_only",
  /** Human principals must not call this route (default deny). */
  HUMAN_PRINCIPAL_DENIED: "human_principal_denied",
} as const;

export type V1RouteAccessClass =
  (typeof V1_ROUTE_ACCESS_CLASSES)[keyof typeof V1_ROUTE_ACCESS_CLASSES];

const ACCESS_CLASS_VALUES = new Set<string>(
  Object.values(V1_ROUTE_ACCESS_CLASSES),
);

export function isV1RouteAccessClass(
  value: string,
): value is V1RouteAccessClass {
  return ACCESS_CLASS_VALUES.has(value);
}

export function authorizationActionToHumanPermission(
  action: AuthorizationAction,
): HumanWorkspacePermission {
  switch (action) {
    case AUTHORIZATION_ACTIONS.READ:
      return HUMAN_WORKSPACE_PERMISSIONS.READ;
    case AUTHORIZATION_ACTIONS.EXECUTE:
      return HUMAN_WORKSPACE_PERMISSIONS.EXECUTE;
    case AUTHORIZATION_ACTIONS.WRITE:
      return HUMAN_WORKSPACE_PERMISSIONS.WRITE;
    case AUTHORIZATION_ACTIONS.ADMIN:
      return HUMAN_WORKSPACE_PERMISSIONS.ADMINISTER_WORKSPACE;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function isHumanPermittedControlPlaneAccessClass(
  accessClass: V1RouteAccessClass,
): boolean {
  return accessClass === V1_ROUTE_ACCESS_CLASSES.CONTROL_PLANE_WORKSPACE;
}
