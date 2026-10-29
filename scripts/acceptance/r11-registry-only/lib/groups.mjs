/** @typedef {"preflight" | "stack" | "workflow" | "mcp" | "consumers" | "multipart" | "restart" | "full"} R11Group */

/** @type {readonly R11Group[]} */
export const ALL_GROUPS = [
  "preflight",
  "stack",
  "workflow",
  "mcp",
  "consumers",
  "multipart",
  "restart",
];

/**
 * @param {string[] | undefined} argv
 * @returns {Set<R11Group>}
 */
export function parseGroups(argv = process.argv.slice(2)) {
  const fromEnv = process.env.OSVA_R11_GROUPS?.trim();
  let raw = fromEnv;
  for (const arg of argv) {
    if (arg.startsWith("--group=")) {
      raw = arg.slice("--group=".length);
    }
  }
  if (raw === undefined || raw.length === 0 || raw === "full") {
    return new Set(ALL_GROUPS);
  }
  /** @type {Set<R11Group>} */
  const selected = new Set();
  for (const part of raw.split(",").map((piece) => piece.trim())) {
    if (part === "full") {
      return new Set(ALL_GROUPS);
    }
    if (!ALL_GROUPS.includes(/** @type {R11Group} */ (part))) {
      throw new Error(`Unknown R11 group '${part}'.`);
    }
    selected.add(/** @type {R11Group} */ (part));
  }
  if (selected.size === 0) {
    return new Set(ALL_GROUPS);
  }
  if (
    selected.has("consumers") ||
    selected.has("restart") ||
    selected.has("workflow") ||
    selected.has("mcp") ||
    selected.has("multipart")
  ) {
    selected.add("stack");
  }
  return selected;
}

/**
 * @param {Set<R11Group>} groups
 * @param {R11Group} group
 */
export function runsGroup(groups, group) {
  return groups.has(group);
}
