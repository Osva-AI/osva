/**
 * Canonical JSON-compatible values used for Run input and RunAttempt output.
 * Functions, Symbols, BigInt, cyclic structures, class instances, NaN, and
 * Infinity cannot be represented and must be rejected rather than stringified.
 */
export type JsonPrimitive = null | boolean | number | string;

export type JsonObject = { readonly [key: string]: JsonValue };

export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export function isCanonicalJsonValue(value: unknown): value is JsonValue {
  return checkCanonicalJsonValue(value, new WeakSet<object>());
}

function checkCanonicalJsonValue(
  value: unknown,
  seen: WeakSet<object>,
): boolean {
  if (value === null) {
    return true;
  }

  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      if (seen.has(value)) {
        return false;
      }

      seen.add(value);

      if (Array.isArray(value)) {
        return value.every((item) => checkCanonicalJsonValue(item, seen));
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        return false;
      }

      if (Object.getOwnPropertySymbols(value).length > 0) {
        return false;
      }

      return Object.values(value).every((nested) =>
        checkCanonicalJsonValue(nested, seen),
      );
    }
    default:
      return false;
  }
}
