export function isChildJsonValue(value: unknown): boolean {
  return checkValue(value, new WeakSet<object>());
}

function checkValue(value: unknown, seen: WeakSet<object>): boolean {
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
        return value.every((item) => checkValue(item, seen));
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        return false;
      }

      if (Object.getOwnPropertySymbols(value).length > 0) {
        return false;
      }

      return Object.values(value).every((nested) => checkValue(nested, seen));
    }
    default:
      return false;
  }
}

export function deepFreezeChildValue<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreezeChildValue(item);
    }

    return value;
  }

  for (const nested of Object.values(value)) {
    deepFreezeChildValue(nested);
  }

  return value;
}
