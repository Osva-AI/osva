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
  "evaluation-comparisons",
  "pairwise-results",
  "assessment",
  "human-reviews",
  "calibration",
  "case-results",
  "tools",
  "runs",
  "stream",
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
  "threads",
  "messages",
  "inbox",
  "read-state",
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
  "builder",
  "proposals",
  "generate",
  "refine",
  "validate",
  "publications",
  "prepare",
  "batch-inference-jobs",
  "items",
  "inference-routing-policies",
  "inference-routing-policy-versions",
  "inference-routing-decisions",
  "activate",
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

function readPathMatchRegexLiteralBody(
  source: string,
  openSlashIndex: number,
): string | null {
  let index = openSlashIndex + 1;
  let inCharacterClass = false;
  while (index < source.length) {
    const character = source.charAt(index);
    if (inCharacterClass) {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === "]") {
        inCharacterClass = false;
      }
      index += 1;
      continue;
    }
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      index += 1;
      continue;
    }
    if (character === "/") {
      return source.slice(openSlashIndex + 1, index);
    }
    index += 1;
  }
  return null;
}

/** Regex literal bodies from `path.match(/.../)`, including multiline Prettier layouts. */
export function extractPathMatchRegexPatternBodies(source: string): string[] {
  const bodies: string[] = [];
  const anchor = /path\.match\s*\(/g;
  let found: RegExpExecArray | null;
  while ((found = anchor.exec(source)) !== null) {
    let index = found.index + found[0].length;
    while (index < source.length && /\s/.test(source.charAt(index))) {
      index += 1;
    }
    if (source.charAt(index) !== "/") {
      continue;
    }
    const body = readPathMatchRegexLiteralBody(source, index);
    if (body !== null) {
      bodies.push(body);
    }
  }
  return bodies;
}

function pathMatchPatternBodyToProbePath(patternBody: string): string {
  let normalized = patternBody
    .replace(/\\\//g, "/")
    .replace(/\(\[\^\/\]\+\)/g, PROBE_SEGMENT)
    .replace(/^\^/, "")
    .replace(/\$$/, "");
  normalized = normalized.replace(/^\//, "");
  if (!normalized.startsWith("v1/")) {
    normalized = `v1/${normalized}`;
  }
  return `/${normalized}`;
}

function enumeratePathMatchProbePaths(source: string): Set<string> {
  const paths = new Set<string>();
  for (const body of extractPathMatchRegexPatternBodies(source)) {
    paths.add(pathMatchPatternBodyToProbePath(body));
  }
  return paths;
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

  if (matchBody.includes('segments[2] === "threads"')) {
    paths.add("/v1/office/threads");
    paths.add(`/v1/office/threads/${PROBE_SEGMENT}`);
    paths.add(`/v1/office/threads/${PROBE_SEGMENT}/messages`);
  }

  if (matchBody.includes('segments[2] === "inbox"')) {
    paths.add("/v1/office/inbox");
    paths.add("/v1/office/inbox/read-state");
  }

  if (matchBody.includes('"evaluation-comparisons"')) {
    paths.add("/v1/evaluation-comparisons");
    paths.add(`/v1/evaluation-comparisons/${PROBE_SEGMENT}`);
    paths.add(`/v1/evaluation-comparisons/${PROBE_SEGMENT}/pairwise-results`);
    paths.add(`/v1/evaluation-comparisons/${PROBE_SEGMENT}/assessment`);
    paths.add(`/v1/evaluation-comparisons/${PROBE_SEGMENT}/human-reviews`);
    paths.add(`/v1/evaluation-comparisons/${PROBE_SEGMENT}/calibration`);
  }

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

    if (resource === "threads") {
      paths.add(`/v1/office/threads/${PROBE_SEGMENT}/messages`);
    }

    if (resource === "inbox") {
      paths.add("/v1/office/inbox/read-state");
    }
  }

  return paths;
}

export function enumerateProbePathsFromHandlerSource(source: string): string[] {
  const stripped = stripV1HttpRoutesExport(source);
  const paths = new Set<string>();

  addExactPathChecks(stripped, paths);

  let searchFrom = 0;
  while (searchFrom < stripped.length) {
    const slice = stripped.slice(searchFrom);
    const relativeStart = slice.search(/function match\w+Route\(/);
    if (relativeStart < 0) {
      break;
    }
    const absoluteStart = searchFrom + relativeStart;
    const matchBody = extractMatchRouteFunctionBody(
      stripped.slice(absoluteStart),
    );
    if (matchBody === null) {
      break;
    }
    for (const path of enumerateSliceSegmentPaths(matchBody)) {
      paths.add(path);
    }
    for (const path of enumerateSplitSegmentPaths(matchBody)) {
      paths.add(path);
    }
    searchFrom = absoluteStart + matchBody.length;
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

  for (const path of enumeratePathMatchProbePaths(stripped)) {
    paths.add(path);
  }

  return [...paths].sort();
}

export function officeListQuery(): string {
  return "";
}
