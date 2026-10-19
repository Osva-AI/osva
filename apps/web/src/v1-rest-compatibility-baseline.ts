import type { AuthorizationAction } from "@osva-ai/contracts";

import { inferV1RouteAuthorizationAction } from "./v1-route-authorization-policy.js";
import {
  V1_ROUTE_INVENTORY,
  type V1HandlerModule,
} from "./v1-route-inventory.js";
import { structuralKeyFromInventoryRoute } from "./v1-route-structural-key.js";

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

export interface V1RestCompatibilityBaselineEntry {
  readonly method: string;
  readonly path: string;
  readonly authenticationRequired: true;
  readonly minAuthorizationAction: AuthorizationAction;
  readonly resourceFamily: string;
}

/** Stage 3.7 frozen REST `/v1` security compatibility baseline. */
export const V1_REST_COMPATIBILITY_BASELINE: readonly V1RestCompatibilityBaselineEntry[] =
  V1_ROUTE_INVENTORY.map((route) => {
    const structuralKey = structuralKeyFromInventoryRoute(route);
    return {
      method: route.method,
      path: route.path,
      authenticationRequired: true as const,
      minAuthorizationAction: inferV1RouteAuthorizationAction(
        route.method,
        structuralKey,
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
