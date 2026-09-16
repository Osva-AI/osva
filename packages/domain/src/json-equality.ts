import type { JsonValue } from "@osva/contracts";

/**
 * Structural canonical JSON equality. Object property order does not affect
 * the result.
 */
export function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: JsonValue): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: JsonValue): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }

  const objectValue = value as Record<string, JsonValue>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(objectValue).sort()) {
    sorted[key] = sortKeys(objectValue[key] as JsonValue);
  }

  return sorted;
}
