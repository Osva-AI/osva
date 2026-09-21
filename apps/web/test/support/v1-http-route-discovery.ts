/**
 * Read-only discovery of /v1 HTTP routes from handler source (not V1_HTTP_ROUTES exports).
 * Mirror of scripts/lib/v1-http-route-discovery.mjs for typed web tests.
 */

export const PROBE_SEGMENT = "route-probe-id";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const STATIC_V1_SEGMENTS = new Set([
  "v1",
  "agents",
  "versions",
  "model-profiles",
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
]);

export function stripV1HttpRoutesExport(source: string): string {
  return source.replace(
    /\nexport const V1_HTTP_ROUTES = \[[\s\S]*?\] as const;\n?/,
    "\n",
  );
}

export function normalizeInventoryPath(path: string): string {
  return path.replace(/\/$/, "") || "/";
}

export function structuralRouteKey(method: string, path: string): string {
  const parts = normalizeInventoryPath(path).split("/").filter(Boolean);
  const normalized = parts.map((part) =>
    STATIC_V1_SEGMENTS.has(part) ? part : "*",
  );
  return `${method} /${normalized.join("/")}`;
}

export function structuralKeyFromInventoryRoute(route: {
  method: string;
  path: string;
}): string {
  const parts = normalizeInventoryPath(route.path).split("/").filter(Boolean);
  const normalized = parts.map((part) => (part.startsWith(":") ? "*" : part));
  return `${route.method} /${normalized.join("/")}`;
}

function extractMatchRouteFunctionBody(source: string): string | null {
  const start = source.search(/function match\w+Route\(/);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let began = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      depth += 1;
      began = true;
    }
    if (character === "}") {
      depth -= 1;
      if (began && depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return null;
}

function addExactPathChecks(source: string, paths: Set<string>): void {
  for (const match of source.matchAll(
    /path\s*===\s*"(\/v1[^"]+)"(?:\s*\|\|\s*path\s*===\s*"(\/v1[^"]+)")?/g,
  )) {
    const primary = match[1];
    if (primary !== undefined) {
      paths.add(normalizeInventoryPath(primary));
    }
    if (match[2] !== undefined) {
      paths.add(normalizeInventoryPath(match[2]));
    }
  }

  for (const match of source.matchAll(/path\s*!==\s*"(\/v1[^"]+)"/g)) {
    const pathLiteral = match[1];
    if (pathLiteral !== undefined) {
      paths.add(normalizeInventoryPath(pathLiteral));
    }
  }
}

function enumerateRegexProbePaths(source: string): Set<string> {
  const paths = new Set<string>();
  for (const match of source.matchAll(
    /\/\^\\\/v1\\\/(.+?)\$\/\.exec\(path\)/g,
  )) {
    const pattern = match[1];
    if (pattern === undefined) {
      continue;
    }
    const tail = pattern
      .replace(/\\\//g, "/")
      .replace(/\(\[\^\/\]\+\)/g, PROBE_SEGMENT);
    paths.add(`/v1/${tail}`);
  }
  return paths;
}

function enumerateSliceSegmentPaths(matchBody: string): Set<string> {
  const paths = new Set<string>();
  const prefixes = [
    ...new Set(
      [...matchBody.matchAll(/\.slice\("([^"]+)"\.length\)/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  if (prefixes.length === 0) {
    return paths;
  }

  const branchRe =
    /if\s*\([\s\S]*?segments\.length\s*===\s*(\d+)[\s\S]*?\)\s*\{[\s\S]*?return\s*\{/g;

  for (const prefixWithSlash of prefixes) {
    if (prefixWithSlash === undefined) {
      continue;
    }
    const collectionPath = normalizeInventoryPath(
      prefixWithSlash.replace(/\/$/, ""),
    );
    paths.add(collectionPath);

    for (const branch of matchBody.matchAll(branchRe)) {
      const length = Number(branch[1]);
      const branchText = branch[0];
      const segments = Array.from({ length }, () => PROBE_SEGMENT);

      for (const staticMatch of branchText.matchAll(
        /segments\[(\d+)\]\s*===\s*"([^"]+)"/g,
      )) {
        const index = Number(staticMatch[1]);
        const value = staticMatch[2];
        if (index < segments.length && value !== undefined) {
          segments[index] = value;
        }
      }

      const suffix = segments.join("/");
      paths.add(`${collectionPath}/${suffix}`);
    }
  }

  return paths;
}

function enumerateSplitSegmentPaths(matchBody: string): Set<string> {
  const paths = new Set<string>();
  if (!matchBody.includes('path.split("/")')) {
    return paths;
  }

  const branchRe =
    /if\s*\([\s\S]*?segments\.length\s*===\s*(\d+)[\s\S]*?\)\s*\{[\s\S]*?return\s*\{/g;

  for (const branch of matchBody.matchAll(branchRe)) {
    const length = Number(branch[1]);
    const branchText = branch[0];
    const segments: string[] = Array.from({ length }, (_, index) =>
      index === 0 ? "v1" : PROBE_SEGMENT,
    );

    for (const staticMatch of branchText.matchAll(
      /segments\[(\d+)\]\s*===\s*"([^"]+)"/g,
    )) {
      const index = Number(staticMatch[1]);
      const value = staticMatch[2];
      if (index < segments.length && value !== undefined) {
        segments[index] = value;
      }
    }

    paths.add(`/${segments.join("/")}`);
  }

  const resources = [...matchBody.matchAll(/resource\s*===\s*"([^"]+)"/g)].map(
    (match) => match[1],
  );

  for (const resource of new Set(resources)) {
    paths.add(`/v1/office/${resource}`);
    paths.add(`/v1/office/${resource}/${PROBE_SEGMENT}`);

    if (resource === "teams") {
      paths.add(`/v1/office/teams/${PROBE_SEGMENT}/memberships`);
    }

    if (resource === "assignments") {
      paths.add(`/v1/office/assignments/${PROBE_SEGMENT}/launch`);
      paths.add(`/v1/office/assignments/${PROBE_SEGMENT}/cancel`);
    }
  }

  return paths;
}

export function enumerateProbePathsFromHandlerSource(source: string): string[] {
  const stripped = stripV1HttpRoutesExport(source);
  const paths = new Set<string>();

  addExactPathChecks(stripped, paths);

  const matchBody = extractMatchRouteFunctionBody(stripped);
  if (matchBody) {
    for (const path of enumerateSliceSegmentPaths(matchBody)) {
      paths.add(path);
    }
    for (const path of enumerateSplitSegmentPaths(matchBody)) {
      paths.add(path);
    }
  }

  for (const match of stripped.matchAll(
    /"(\/v1\/[a-z0-9-]+(?:\/[a-z0-9-]+)*)"/g,
  )) {
    const literal = match[1];
    if (literal === undefined) {
      continue;
    }
    const candidate = normalizeInventoryPath(literal);
    if (!candidate.includes("${")) {
      paths.add(candidate);
    }
  }

  for (const path of enumerateRegexProbePaths(stripped)) {
    paths.add(path);
  }

  return [...paths].sort();
}

export function officeListQuery(): string {
  return "";
}
