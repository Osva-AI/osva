export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }

    return value;
  }

  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }

  return value;
}
