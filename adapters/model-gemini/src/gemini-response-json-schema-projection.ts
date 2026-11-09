import type { JsonSchemaRecord } from "@osva-ai/contracts";

/**
 * Documented responseJsonSchema keyword subset (Gemini API structured outputs).
 * @see https://ai.google.dev/gemini-api/docs/structured-output
 */
export const GEMINI_DOCUMENTED_RESPONSE_JSON_SCHEMA_KEYWORDS = [
  "$id",
  "$defs",
  "$ref",
  "$anchor",
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "oneOf",
  "properties",
  "additionalProperties",
  "required",
] as const;

/**
 * Constraints removed or transformed for the provider wire schema only.
 * Canonical schema and domain parsing remain authoritative.
 */
export const GEMINI_RESPONSE_JSON_SCHEMA_PROJECTION_ENFORCEMENT = {
  pattern:
    "Removed from Gemini responseJsonSchema; enforced by OSVA domain builder parser (agent refs, RFC6901 selectors).",
  const:
    "Projected to single-value string enum for Gemini; domain parser enforces exact literals and kinds.",
} as const;

/**
 * Deep-clones a JSON Schema record for Gemini `responseJsonSchema`.
 * - string `const` → `enum: [value]` (documented keyword)
 * - `pattern` omitted (not in documented subset; domain validates)
 */
export function projectJsonSchemaForGeminiResponseJsonSchema(
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
    if (key === "pattern") {
      continue;
    }

    if (key === "const") {
      if (typeof value === "string") {
        projected.enum = [value];
      }
      continue;
    }

    projected[key] = projectNode(value);
  }

  return projected;
}

const SCHEMA_META_KEY = new Set<string>(
  GEMINI_DOCUMENTED_RESPONSE_JSON_SCHEMA_KEYWORDS,
);

const SCHEMA_DESCENT_KEYS = new Set([
  "properties",
  "items",
  "anyOf",
  "oneOf",
  "prefixItems",
  "$defs",
  "additionalProperties",
]);

/** Collects JSON Schema meta-keywords (not JSON property names under `properties`). */
export function collectJsonSchemaMetaKeywordSet(schema: unknown): Set<string> {
  const keys = new Set<string>();
  walkSchemaMetaKeywords(schema, keys);
  return keys;
}

function walkSchemaMetaKeywords(node: unknown, keys: Set<string>): void {
  if (node === null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walkSchemaMetaKeywords(item, keys);
    }
    return;
  }
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (SCHEMA_META_KEY.has(key)) {
      keys.add(key);
    }
    if (SCHEMA_DESCENT_KEYS.has(key)) {
      if (key === "properties" && value !== null && typeof value === "object") {
        for (const sub of Object.values(value as Record<string, unknown>)) {
          walkSchemaMetaKeywords(sub, keys);
        }
      } else if (Array.isArray(value)) {
        for (const sub of value) {
          walkSchemaMetaKeywords(sub, keys);
        }
      } else {
        walkSchemaMetaKeywords(value, keys);
      }
    }
  }
}
