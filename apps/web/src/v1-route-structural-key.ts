export function normalizeInventoryPath(path: string): string {
  return path.replace(/\/$/, "") || "/";
}

export function structuralKeyFromInventoryRoute(route: {
  readonly method: string;
  readonly path: string;
}): string {
  const parts = normalizeInventoryPath(route.path).split("/").filter(Boolean);
  const normalized = parts.map((part) => (part.startsWith(":") ? "*" : part));
  return `${route.method} /${normalized.join("/")}`;
}

const STATIC_V1_SEGMENTS = new Set([
  "v1",
  "agents",
  "versions",
  "model-profiles",
  "model-provider-connections",
  "test",
  "connectors",
  "discover",
  "import-mcp-tools",
  "memory",
  "namespaces",
  "records",
  "artifacts",
  "content",
  "knowledge-sources",
  "knowledge-indexes",
  "indexes",
  "knowledge",
  "retrieve",
  "retry",
  "evaluation-suites",
  "evaluation-runs",
  "case-results",
  "tools",
  "runs",
  "attempts",
  "steps",
  "usage",
  "evaluations",
  "schedules",
  "occurrences",
  "workflows",
  "workflow-runs",
  "workflow-events",
  "approval-requests",
  "decision",
  "auth",
  "context",
  "api-keys",
  "revoke",
  "office",
  "workers",
  "roles",
  "teams",
  "memberships",
  "goals",
  "assignments",
  "launch",
  "cancel",
  "me",
  "workspaces",
  "select",
  "audit-events",
  "login",
  "logout",
  "session",
  "setup",
  "recovery",
  "complete",
  "reset",
]);

/** Structural key for an incoming request path (dynamic segments become `*`). */
export function structuralRouteKeyFromPathname(
  method: string,
  pathname: string,
): string {
  const parts = normalizeInventoryPath(pathname).split("/").filter(Boolean);
  const normalized = parts.map((part) =>
    STATIC_V1_SEGMENTS.has(part) ? part : "*",
  );
  return `${method} /${normalized.join("/")}`;
}
