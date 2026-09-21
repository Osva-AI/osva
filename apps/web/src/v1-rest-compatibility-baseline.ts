import {
  AUTHORIZATION_ACTIONS,
  type AuthorizationAction,
} from "@osva/contracts";

import {
  V1_ROUTE_INVENTORY,
  routeInventoryKey,
  type V1HandlerModule,
} from "./v1-route-inventory.js";

const ADMIN_ROUTE_KEYS = new Set<string>([
  "POST /v1/connectors",
  "PATCH /v1/connectors/:connectorId",
  "POST /v1/connectors/:connectorId/versions",
  "POST /v1/connectors/import-mcp-tools",
  "GET /v1/api-keys",
  "POST /v1/api-keys",
  "POST /v1/api-keys/:apiKeyId/revoke",
]);

const EXECUTE_ROUTE_KEYS = new Set<string>([
  "POST /v1/runs",
  "POST /v1/workflow-runs",
  "POST /v1/evaluation-runs",
  "POST /v1/workflow-events",
  "POST /v1/connectors/:connectorId/versions/:connectorVersionId/discover",
  "POST /v1/runs/:runId/attempts/:runAttemptId/evaluations",
  "POST /v1/approval-requests/:approvalRequestId/decision",
  "POST /v1/office/assignments/:assignmentId/launch",
  "POST /v1/office/assignments/:assignmentId/cancel",
]);

const MODULE_RESOURCE_FAMILIES: Record<V1HandlerModule, string> = {
  "auth-http": "auth_context",
  "api-key-http": "api_key",
  "agent-http": "agent",
  "model-profile-http": "model_profile",
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

export interface V1RestCompatibilityBaselineEntry {
  readonly method: string;
  readonly path: string;
  readonly authenticationRequired: true;
  readonly minAuthorizationAction: AuthorizationAction;
  readonly resourceFamily: string;
}

function inferMinAuthorizationAction(
  method: string,
  routeKey: string,
): AuthorizationAction {
  if (ADMIN_ROUTE_KEYS.has(routeKey)) {
    return AUTHORIZATION_ACTIONS.ADMIN;
  }
  if (EXECUTE_ROUTE_KEYS.has(routeKey)) {
    return AUTHORIZATION_ACTIONS.EXECUTE;
  }
  if (method === "POST" || method === "PATCH") {
    return AUTHORIZATION_ACTIONS.WRITE;
  }
  return AUTHORIZATION_ACTIONS.READ;
}

/** Stage 3.7 frozen REST `/v1` security compatibility baseline. */
export const V1_REST_COMPATIBILITY_BASELINE: readonly V1RestCompatibilityBaselineEntry[] =
  V1_ROUTE_INVENTORY.map((route) => {
    const routeKey = routeInventoryKey(route);
    return {
      method: route.method,
      path: route.path,
      authenticationRequired: true as const,
      minAuthorizationAction: inferMinAuthorizationAction(
        route.method,
        routeKey,
      ),
      resourceFamily: MODULE_RESOURCE_FAMILIES[route.module],
    };
  });

export function v1RestCompatibilityBaselineKey(entry: {
  readonly method: string;
  readonly path: string;
}): string {
  return `${entry.method} ${entry.path}`;
}
