import { createHash } from "node:crypto";

import type { JsonValue } from "@osva-ai/contracts";
import { APPROVAL_OPERATION_DIGEST_PREFIX } from "@osva-ai/contracts";

/**
 * Structural canonical JSON equality. Object property order does not affect
 * the result.
 */
export function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

export function canonicalJsonStringify(value: JsonValue): string {
  return JSON.stringify(sortKeys(value));
}

export function digestCanonicalJsonValue(value: JsonValue): string {
  const digest = createHash("sha256")
    .update(canonicalJsonStringify(value), "utf8")
    .digest("hex");
  return `${APPROVAL_OPERATION_DIGEST_PREFIX}${digest}`;
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
