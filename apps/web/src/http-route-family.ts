const KNOWN_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const V1_ROUTE_PREFIXES: readonly {
  readonly prefix: string;
  readonly family: string;
}[] = [
  { prefix: "/v1/auth", family: "v1.auth" },
  { prefix: "/v1/api-keys", family: "v1.api_keys" },
  { prefix: "/v1/agents", family: "v1.agents" },
  { prefix: "/v1/model-profiles", family: "v1.model_profiles" },
  { prefix: "/v1/connectors", family: "v1.connectors" },
  { prefix: "/v1/memory", family: "v1.memory" },
  { prefix: "/v1/artifacts", family: "v1.artifacts" },
  { prefix: "/v1/knowledge-sources", family: "v1.knowledge" },
  { prefix: "/v1/knowledge-indexes", family: "v1.knowledge" },
  { prefix: "/v1/knowledge", family: "v1.knowledge" },
  { prefix: "/v1/evaluation-suites", family: "v1.evaluations" },
  { prefix: "/v1/evaluation-runs", family: "v1.evaluations" },
  { prefix: "/v1/evaluations", family: "v1.evaluations" },
  { prefix: "/v1/tools", family: "v1.tools" },
  { prefix: "/v1/runs", family: "v1.runs" },
  { prefix: "/v1/schedules", family: "v1.schedules" },
  { prefix: "/v1/workflow-events", family: "v1.workflow_events" },
  { prefix: "/v1/workflow-runs", family: "v1.workflows" },
  { prefix: "/v1/workflows", family: "v1.workflows" },
  { prefix: "/v1/approval-requests", family: "v1.approvals" },
  { prefix: "/v1/office", family: "v1.office" },
];

export function classifyHttpMethod(method: string): string {
  const normalized = method.trim().toUpperCase();
  return KNOWN_METHODS.has(normalized) ? normalized : "OTHER";
}

export function classifyHttpRouteFamily(pathname: string): string {
  if (pathname === "/health" || pathname === "/health/") {
    return "health";
  }
  if (pathname === "/ready" || pathname === "/ready/") {
    return "ready";
  }

  for (const entry of V1_ROUTE_PREFIXES) {
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) {
      return entry.family;
    }
  }

  if (pathname === "/v1" || pathname.startsWith("/v1/")) {
    return "v1.other";
  }

  return "other";
}

export function classifyHttpStatusClass(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) {
    return "2xx";
  }
  if (statusCode >= 300 && statusCode < 400) {
    return "3xx";
  }
  if (statusCode >= 400 && statusCode < 500) {
    return "4xx";
  }
  if (statusCode >= 500 && statusCode < 600) {
    return "5xx";
  }
  return "unknown";
}

export function isProbeRouteFamily(routeFamily: string): boolean {
  return routeFamily === "health" || routeFamily === "ready";
}
