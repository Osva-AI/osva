import type { JsonSchemaRecord } from "@osva-ai/contracts";

/**
 * Keywords omitted from Anthropic `output_config.format.schema` wire projection.
 * OSVA domain validation remains authoritative after generation.
 *
 * @see https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 */
export const ANTHROPIC_UNSUPPORTED_JSON_SCHEMA_CONSTRAINT_KEYS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
  /**
   * Omitted on the wire: Builder patterns (agent refs, RFC6901 selectors) can
   * exceed Anthropic grammar regex limits; OSVA domain validation stays authoritative.
   */
  "pattern",
] as const;

const UNSUPPORTED_CONSTRAINT_KEYS = new Set<string>(
  ANTHROPIC_UNSUPPORTED_JSON_SCHEMA_CONSTRAINT_KEYS,
);

const SCHEMA_DESCENT_KEYS = new Set([
  "properties",
  "items",
  "anyOf",
  "oneOf",
  "allOf",
  "prefixItems",
  "$defs",
  "definitions",
  "additionalProperties",
]);

/**
 * Deep-clone canonical builder JSON Schema for Anthropic Messages `output_config`.
 * - Drops numerical and string-length constraints unsupported on the provider wire.
 * - Rewrites `type: ["string", "null"]` unions into `anyOf` (provider subset).
 */
export function projectJsonSchemaForAnthropicOutput(
  schema: JsonSchemaRecord,
): JsonSchemaRecord {
  return projectNode(schema) as JsonSchemaRecord;
}

function projectNode(node: unknown): unknown {
  if (node === null || typeof node !== "object") {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map((item) => projectNode(item));
  }

  const record = node as Record<string, unknown>;
  const projected: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (UNSUPPORTED_CONSTRAINT_KEYS.has(key)) {
      continue;
    }
    if (key === "minItems") {
      const n = typeof value === "number" ? value : Number(value);
      if (!(n === 0 || n === 1)) {
        continue;
      }
    }
    if (key === "type" && Array.isArray(value) && value.length > 1) {
      projected.anyOf = value.map((t) => ({ type: t }));
      continue;
    }
    projected[key] = projectNode(value);
  }

  return projected;
}

/** Collects JSON Schema meta-keywords present after projection (for tests). */
export function collectAnthropicWireSchemaMetaKeywords(
  schema: unknown,
): Set<string> {
  const keys = new Set<string>();
  walkMeta(schema, keys);
  return keys;
}

function walkMeta(node: unknown, keys: Set<string>): void {
  if (node === null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walkMeta(item, keys);
    }
    return;
  }
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (
      key.startsWith("$") ||
      SCHEMA_DESCENT_KEYS.has(key) ||
      key === "type" ||
      key === "required" ||
      key === "const" ||
      key === "enum" ||
      key === "pattern"
    ) {
      keys.add(key);
    }
    if (SCHEMA_DESCENT_KEYS.has(key)) {
      if (key === "properties" && value !== null && typeof value === "object") {
        for (const sub of Object.values(value as Record<string, unknown>)) {
          walkMeta(sub, keys);
        }
      } else if (key === "additionalProperties" && typeof value === "object") {
        walkMeta(value, keys);
      } else {
        walkMeta(value, keys);
      }
    }
  }
}
