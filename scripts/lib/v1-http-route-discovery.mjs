/**
 * Read-only discovery of /v1 HTTP routes from handler source (not V1_HTTP_ROUTES exports).
 * Used by CI route-inventory tests and optional developer tooling.
 */

const PROBE_SEGMENT = "route-probe-id";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Path segments that are never dynamic IDs in OSVA v1 handlers. */
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

export function stripV1HttpRoutesExport(source) {
  return source.replace(
    /\nexport const V1_HTTP_ROUTES = \[[\s\S]*?\] as const;\n?/,
    "\n",
  );
}

export function normalizeInventoryPath(path) {
  return path.replace(/\/$/, "") || "/";
}

/**
 * Structural route key: dynamic segments become `*` so inventory `:agentId` matches probe ids.
 */
export function structuralRouteKey(method, path) {
  const parts = normalizeInventoryPath(path).split("/").filter(Boolean);
  const normalized = parts.map((part) =>
    STATIC_V1_SEGMENTS.has(part) ? part : "*",
  );
  return `${method} /${normalized.join("/")}`;
}

export function structuralKeyFromInventoryRoute(route) {
  const parts = normalizeInventoryPath(route.path).split("/").filter(Boolean);
  const normalized = parts.map((part) => (part.startsWith(":") ? "*" : part));
  return `${route.method} /${normalized.join("/")}`;
}

function extractMatchRouteFunctionBody(source) {
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

function addExactPathChecks(source, paths) {
  for (const match of source.matchAll(
    /path\s*===\s*"(\/v1[^"]+)"(?:\s*\|\|\s*path\s*===\s*"(\/v1[^"]+)")?/g,
  )) {
    paths.add(normalizeInventoryPath(match[1]));
    if (match[2]) {
      paths.add(normalizeInventoryPath(match[2]));
    }
  }

  for (const match of source.matchAll(/path\s*!==\s*"(\/v1[^"]+)"/g)) {
    paths.add(normalizeInventoryPath(match[1]));
  }
}

function enumerateRegexProbePaths(source) {
  const paths = new Set();
  for (const match of source.matchAll(
    /\/\^\\\/v1\\\/(.+?)\$\/\.exec\(path\)/g,
  )) {
    const tail = match[1]
      .replace(/\\\//g, "/")
      .replace(/\(\[\^\/\]\+\)/g, PROBE_SEGMENT);
    paths.add(`/v1/${tail}`);
  }
  return paths;
}

function enumerateSliceSegmentPaths(matchBody) {
  const paths = new Set();
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
        if (index < segments.length) {
          segments[index] = staticMatch[2];
        }
      }

      const suffix = segments.join("/");
      paths.add(`${collectionPath}/${suffix}`);
    }
  }

  return paths;
}

function enumerateSplitSegmentPaths(matchBody) {
  const paths = new Set();
  if (!matchBody.includes('path.split("/")')) {
    return paths;
  }

  const branchRe =
    /if\s*\([\s\S]*?segments\.length\s*===\s*(\d+)[\s\S]*?\)\s*\{[\s\S]*?return\s*\{/g;

  for (const branch of matchBody.matchAll(branchRe)) {
    const length = Number(branch[1]);
    const branchText = branch[0];
    const segments = Array.from({ length }, (_, index) =>
      index === 0 ? "v1" : PROBE_SEGMENT,
    );

    for (const staticMatch of branchText.matchAll(
      /segments\[(\d+)\]\s*===\s*"([^"]+)"/g,
    )) {
      const index = Number(staticMatch[1]);
      if (index < segments.length) {
        segments[index] = staticMatch[2];
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

export function enumerateProbePathsFromHandlerSource(source) {
  const stripped = stripV1HttpRoutesExport(source);
  const paths = new Set();

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
    const candidate = normalizeInventoryPath(match[1]);
    if (!candidate.includes("${")) {
      paths.add(candidate);
    }
  }

  for (const path of enumerateRegexProbePaths(stripped)) {
    paths.add(path);
  }

  return [...paths].sort();
}

export function officeListQuery() {
  return "";
}

export { HTTP_METHODS, PROBE_SEGMENT };
