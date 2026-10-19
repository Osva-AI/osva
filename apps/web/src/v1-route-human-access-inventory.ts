import {
  authorizationActionToHumanPermission,
  HUMAN_ROUTE_PERMISSIONS,
  HUMAN_AUTH_ROUTE_IDS,
  type AuthorizationAction,
  type HumanWorkspacePermission,
  type V1RouteAccessRecord,
  V1_ROUTE_ACCESS_CLASSES,
} from "@osva-ai/contracts";

import {
  V1_HANDLER_MODULES,
  V1_ROUTE_INVENTORY,
  routeInventoryKey,
  type V1HandlerModule,
} from "./v1-route-inventory.js";
import { inferV1RouteAuthorizationAction } from "./v1-route-authorization-policy.js";
import {
  structuralKeyFromInventoryRoute,
  structuralRouteKeyFromPathname,
} from "./v1-route-structural-key.js";

const MODULE_RESOURCE_FAMILIES: Record<V1HandlerModule, string> = {
  "auth-http": "auth_context",
  "api-key-http": "api_key",
  "agent-http": "agent",
  "model-profile-http": "model_profile",
  "model-provider-connection-http": "model_provider_connection",
  "connector-http": "connector",
  "memory-http": "memory",
  "artifact-http": "artifact",
  "knowledge-http": "knowledge",
  "evaluation-http": "evaluation",
  "tool-http": "tool",
  "run-observability-http": "run_observability",
  "run-http": "run",
  "schedule-http": "schedule",
  "workflow-http": "workflow",
  "workflow-event-http": "workflow_event",
  "office-http": "office",
};

function controlPlaneAccessRecord(
  route: (typeof V1_ROUTE_INVENTORY)[number],
): V1RouteAccessRecord {
  const structuralKey = structuralKeyFromInventoryRoute(route);
  const accessClass =
    route.module === "auth-http"
      ? V1_ROUTE_ACCESS_CLASSES.API_KEY_ONLY
      : V1_ROUTE_ACCESS_CLASSES.CONTROL_PLANE_WORKSPACE;

  const requiredAuthorizationAction: AuthorizationAction =
    inferV1RouteAuthorizationAction(route.method, structuralKey);
  const requiredHumanPermission: HumanWorkspacePermission | null =
    accessClass === V1_ROUTE_ACCESS_CLASSES.CONTROL_PLANE_WORKSPACE
      ? authorizationActionToHumanPermission(requiredAuthorizationAction)
      : null;

  return {
    module: route.module,
    method: route.method,
    path: route.path,
    accessClass,
    workspaceScoped:
      accessClass === V1_ROUTE_ACCESS_CLASSES.CONTROL_PLANE_WORKSPACE,
    requiredHumanPermission,
    requiredAuthorizationAction,
    resourceFamily: MODULE_RESOURCE_FAMILIES[route.module],
  };
}

const HUMAN_AUTH_ROUTE_ID_BY_PATH: Readonly<
  Record<
    string,
    (typeof HUMAN_AUTH_ROUTE_IDS)[keyof typeof HUMAN_AUTH_ROUTE_IDS]
  >
> = {
  "GET /v1/auth/workspaces/*/memberships":
    HUMAN_AUTH_ROUTE_IDS.WORKSPACE_MEMBERSHIPS_LIST,
  "POST /v1/auth/workspaces/*/memberships":
    HUMAN_AUTH_ROUTE_IDS.WORKSPACE_MEMBERSHIP_CREATE,
  "POST /v1/auth/workspaces/*/members/users":
    HUMAN_AUTH_ROUTE_IDS.WORKSPACE_MEMBER_PROVISION,
  "PATCH /v1/auth/workspaces/*/memberships/*":
    HUMAN_AUTH_ROUTE_IDS.WORKSPACE_MEMBERSHIP_UPDATE,
  "DELETE /v1/auth/workspaces/*/memberships/*":
    HUMAN_AUTH_ROUTE_IDS.WORKSPACE_MEMBERSHIP_DELETE,
  "POST /v1/auth/workspaces/*/ownership/transfer":
    HUMAN_AUTH_ROUTE_IDS.WORKSPACE_OWNERSHIP_TRANSFER,
  "POST /v1/auth/workspaces/*/memberships/*/grant-owner":
    HUMAN_AUTH_ROUTE_IDS.WORKSPACE_OWNERSHIP_GRANT,
  "GET /v1/auth/audit-events": HUMAN_AUTH_ROUTE_IDS.AUDIT_EVENTS_LIST,
};

export const V1_HUMAN_AUTH_HTTP_ROUTES = [
  { method: "POST", path: "/v1/auth/login" },
  { method: "POST", path: "/v1/auth/logout" },
  { method: "GET", path: "/v1/auth/session" },
  { method: "POST", path: "/v1/auth/setup/complete" },
  { method: "POST", path: "/v1/auth/setup" },
  { method: "POST", path: "/v1/auth/recovery/complete" },
  { method: "POST", path: "/v1/auth/recovery/reset" },
  { method: "GET", path: "/v1/auth/me" },
  { method: "GET", path: "/v1/me/workspaces" },
  { method: "GET", path: "/v1/auth/workspaces" },
  { method: "POST", path: "/v1/auth/workspaces/select" },
  { method: "GET", path: "/v1/auth/workspaces/:workspaceId/memberships" },
  { method: "POST", path: "/v1/auth/workspaces/:workspaceId/memberships" },
  { method: "POST", path: "/v1/auth/workspaces/:workspaceId/members/users" },
  {
    method: "PATCH",
    path: "/v1/auth/workspaces/:workspaceId/memberships/:membershipId",
  },
  {
    method: "DELETE",
    path: "/v1/auth/workspaces/:workspaceId/memberships/:membershipId",
  },
  {
    method: "POST",
    path: "/v1/auth/workspaces/:workspaceId/ownership/transfer",
  },
  {
    method: "POST",
    path: "/v1/auth/workspaces/:workspaceId/memberships/:membershipId/grant-owner",
  },
  { method: "GET", path: "/v1/auth/audit-events" },
] as const;

function humanAuthAccessRecord(
  route: (typeof V1_HUMAN_AUTH_HTTP_ROUTES)[number],
): V1RouteAccessRecord {
  const structuralKey = structuralKeyFromInventoryRoute(route);
  const publicAuthentication = new Set([
    "POST /v1/auth/login",
    "POST /v1/auth/setup/complete",
    "POST /v1/auth/setup",
    "POST /v1/auth/recovery/complete",
    "POST /v1/auth/recovery/reset",
  ]);

  if (publicAuthentication.has(structuralKey)) {
    return {
      module: "human-auth-http",
      method: route.method,
      path: route.path,
      accessClass: V1_ROUTE_ACCESS_CLASSES.PUBLIC_AUTHENTICATION,
      workspaceScoped: false,
      requiredHumanPermission: null,
      requiredAuthorizationAction: null,
      resourceFamily: "human_identity",
    };
  }

  const workspaceRouteId = HUMAN_AUTH_ROUTE_ID_BY_PATH[structuralKey];
  if (workspaceRouteId !== undefined) {
    const permission = HUMAN_ROUTE_PERMISSIONS[workspaceRouteId];
    return {
      module: "human-auth-http",
      method: route.method,
      path: route.path,
      accessClass: V1_ROUTE_ACCESS_CLASSES.HUMAN_IDENTITY_WORKSPACE,
      workspaceScoped: true,
      requiredHumanPermission: permission,
      requiredAuthorizationAction: null,
      resourceFamily: "human_identity",
    };
  }

  return {
    module: "human-auth-http",
    method: route.method,
    path: route.path,
    accessClass: V1_ROUTE_ACCESS_CLASSES.HUMAN_IDENTITY_SESSION,
    workspaceScoped: false,
    requiredHumanPermission: null,
    requiredAuthorizationAction: null,
    resourceFamily: "human_identity",
  };
}

/** Complete `/v1` human-access inventory (control plane + human identity routes). */
export const V1_ROUTE_ACCESS_INVENTORY: readonly V1RouteAccessRecord[] = [
  ...V1_ROUTE_INVENTORY.map((route) => controlPlaneAccessRecord(route)),
  ...V1_HUMAN_AUTH_HTTP_ROUTES.map((route) => humanAuthAccessRecord(route)),
];

const ACCESS_BY_STRUCTURAL_KEY = new Map<string, V1RouteAccessRecord>(
  V1_ROUTE_ACCESS_INVENTORY.map((record) => [
    structuralKeyFromInventoryRoute(record),
    record,
  ]),
);

export function lookupV1RouteAccess(
  method: string,
  pathname: string,
): V1RouteAccessRecord | undefined {
  const structuralKey = structuralRouteKeyFromPathname(method, pathname);
  return ACCESS_BY_STRUCTURAL_KEY.get(structuralKey);
}

export function validateV1RouteAccessInventory(): readonly string[] {
  const errors: string[] = [];
  const keys = V1_ROUTE_ACCESS_INVENTORY.map((record) =>
    structuralKeyFromInventoryRoute(record),
  );
  if (keys.length !== new Set(keys).size) {
    errors.push("duplicate structural route keys in V1_ROUTE_ACCESS_INVENTORY");
  }

  for (const record of V1_ROUTE_ACCESS_INVENTORY) {
    if (
      record.accessClass === V1_ROUTE_ACCESS_CLASSES.CONTROL_PLANE_WORKSPACE &&
      record.requiredHumanPermission === null
    ) {
      errors.push(
        `control plane route missing human permission: ${record.method} ${record.path}`,
      );
    }
    if (
      record.accessClass === V1_ROUTE_ACCESS_CLASSES.HUMAN_IDENTITY_WORKSPACE &&
      record.requiredHumanPermission === null
    ) {
      errors.push(
        `human workspace route missing permission: ${record.method} ${record.path}`,
      );
    }
  }

  for (const module of V1_HANDLER_MODULES) {
    if (!V1_ROUTE_INVENTORY.some((route) => route.module === module)) {
      errors.push(`handler module missing from route inventory: ${module}`);
    }
  }

  return errors;
}

export { routeInventoryKey };
