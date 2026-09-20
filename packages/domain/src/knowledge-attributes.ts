import type { JsonObject, JsonValue } from "@osva/contracts";

import { KnowledgeInvalidFilterError } from "./errors.js";

export function validateKnowledgeFlatAttributes(
  attributes: JsonObject,
): JsonObject {
  const normalized: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    normalized[key] = validateKnowledgeScalarValue(value);
  }
  return normalized;
}

export function validateKnowledgeScalarValue(value: JsonValue): JsonValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  throw new KnowledgeInvalidFilterError(
    "Knowledge attributes and filters support scalar values only.",
  );
}

export function knowledgeAttributesMatchFilter(
  attributes: JsonObject,
  filter: JsonObject,
): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    const actual = attributes[key];
    if (actual === undefined || !scalarEquals(actual, expected)) {
      return false;
    }
  }
  return true;
}

function scalarEquals(left: JsonValue, right: JsonValue): boolean {
  return left === right;
}
