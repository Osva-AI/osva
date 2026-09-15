export function cloneJsonLike<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonLike(item)) as T;
  }

  const copy: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    copy[key] = cloneJsonLike(nested);
  }

  return copy as T;
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Object.isFrozen(value)) {
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

export function freezeClone<T>(value: T): T {
  return deepFreeze(cloneJsonLike(value));
}
