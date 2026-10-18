import {
  AUTHORIZATION_ACTIONS,
  type AuthorizationAction,
} from "@osva-ai/contracts";

export const V1_ADMIN_ROUTE_KEYS = new Set<string>([
  "POST /v1/connectors",
  "PATCH /v1/connectors/*",
  "POST /v1/connectors/*/versions",
  "POST /v1/connectors/import-mcp-tools",
  "GET /v1/api-keys",
  "POST /v1/api-keys",
  "POST /v1/api-keys/*/revoke",
]);

export const V1_EXECUTE_ROUTE_KEYS = new Set<string>([
  "POST /v1/runs",
  "POST /v1/workflow-runs",
  "POST /v1/evaluation-runs",
  "POST /v1/workflow-events",
  "POST /v1/connectors/*/versions/*/discover",
  "POST /v1/runs/*/attempts/*/evaluations",
  "POST /v1/approval-requests/*/decision",
  "POST /v1/office/assignments/*/launch",
  "POST /v1/office/assignments/*/cancel",
  "POST /v1/knowledge/retrieve",
]);

export function inferV1RouteAuthorizationAction(
  method: string,
  structuralRouteKey: string,
): AuthorizationAction {
  if (V1_ADMIN_ROUTE_KEYS.has(structuralRouteKey)) {
    return AUTHORIZATION_ACTIONS.ADMIN;
  }
  if (V1_EXECUTE_ROUTE_KEYS.has(structuralRouteKey)) {
    return AUTHORIZATION_ACTIONS.EXECUTE;
  }
  if (method === "POST" || method === "PATCH") {
    return AUTHORIZATION_ACTIONS.WRITE;
  }
  return AUTHORIZATION_ACTIONS.READ;
}
