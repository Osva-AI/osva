import { V1_HTTP_ROUTES as authHttpRoutes } from "./auth-http.js";
import { V1_HTTP_ROUTES as apiKeyHttpRoutes } from "./api-key-http.js";
import { V1_HTTP_ROUTES as agentHttpRoutes } from "./agent-http.js";
import { V1_HTTP_ROUTES as modelProfileHttpRoutes } from "./model-profile-http.js";
import { V1_HTTP_ROUTES as connectorHttpRoutes } from "./connector-http.js";
import { V1_HTTP_ROUTES as memoryHttpRoutes } from "./memory-http.js";
import { V1_HTTP_ROUTES as artifactHttpRoutes } from "./artifact-http.js";
import { V1_HTTP_ROUTES as knowledgeHttpRoutes } from "./knowledge-http.js";
import { V1_HTTP_ROUTES as evaluationHttpRoutes } from "./evaluation-http.js";
import { V1_HTTP_ROUTES as toolHttpRoutes } from "./tool-http.js";
import { V1_HTTP_ROUTES as runObservabilityHttpRoutes } from "./run-observability-http.js";
import { V1_HTTP_ROUTES as runHttpRoutes } from "./run-http.js";
import { V1_HTTP_ROUTES as scheduleHttpRoutes } from "./schedule-http.js";
import { V1_HTTP_ROUTES as workflowHttpRoutes } from "./workflow-http.js";
import { V1_HTTP_ROUTES as workflowEventHttpRoutes } from "./workflow-event-http.js";
import { V1_HTTP_ROUTES as officeHttpRoutes } from "./office-http.js";

function withModule<const M extends string>(
  module: M,
  routes: ReadonlyArray<{ readonly method: string; readonly path: string }>,
) {
  return routes.map((route) => ({ module, ...route }));
}

/** Pass 2 control-plane route inventory (one row per HTTP method + path pattern). */
export const V1_ROUTE_INVENTORY = [
  ...withModule("auth-http", authHttpRoutes),
  ...withModule("api-key-http", apiKeyHttpRoutes),
  ...withModule("agent-http", agentHttpRoutes),
  ...withModule("model-profile-http", modelProfileHttpRoutes),
  ...withModule("connector-http", connectorHttpRoutes),
  ...withModule("memory-http", memoryHttpRoutes),
  ...withModule("artifact-http", artifactHttpRoutes),
  ...withModule("knowledge-http", knowledgeHttpRoutes),
  ...withModule("evaluation-http", evaluationHttpRoutes),
  ...withModule("tool-http", toolHttpRoutes),
  ...withModule("run-observability-http", runObservabilityHttpRoutes),
  ...withModule("run-http", runHttpRoutes),
  ...withModule("schedule-http", scheduleHttpRoutes),
  ...withModule("workflow-http", workflowHttpRoutes),
  ...withModule("workflow-event-http", workflowEventHttpRoutes),
  ...withModule("office-http", officeHttpRoutes),
] as const;

export const V1_HANDLER_MODULES = [
  "auth-http",
  "api-key-http",
  "agent-http",
  "model-profile-http",
  "connector-http",
  "memory-http",
  "artifact-http",
  "knowledge-http",
  "evaluation-http",
  "tool-http",
  "run-observability-http",
  "run-http",
  "schedule-http",
  "workflow-http",
  "workflow-event-http",
  "office-http",
] as const;

export type V1HandlerModule = (typeof V1_HANDLER_MODULES)[number];

export function routeInventoryKey(route: {
  readonly method: string;
  readonly path: string;
}): string {
  return `${route.method} ${route.path}`;
}
