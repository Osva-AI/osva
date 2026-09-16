import { isCanonicalJsonValue } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";

export function copyInstant(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DomainInvariantError("Timestamp must be a valid Date.");
  }

  return new Date(value.getTime());
}

export function requireNonEmptyString(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainInvariantError(`${field} must be a non-empty string.`);
  }

  return value;
}

export function requireBoundedNonEmptyString(
  value: string,
  field: string,
  maxLength: number,
): string {
  const normalized = requireNonEmptyString(value, field);
  if (normalized.length > maxLength) {
    throw new DomainInvariantError(
      `${field} must be at most ${maxLength} characters.`,
    );
  }

  return normalized;
}

export function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new DomainInvariantError(`${field} must be a positive integer.`);
  }

  return value;
}

export function requireNonNegativeInteger(
  value: number,
  field: string,
): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new DomainInvariantError(`${field} must be a non-negative integer.`);
  }

  return value;
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

export function freezeClone<T>(value: T): T {
  return deepFreeze(cloneJsonLike(value));
}

export function freezeRecord<V>(
  record: Readonly<Record<string, V>>,
): Readonly<Record<string, V>> {
  return Object.freeze({ ...record });
}

export function copyJsonValue(value: unknown, field: string): unknown {
  if (value === undefined) {
    throw new DomainInvariantError(`${field} is required.`);
  }

  try {
    return freezeClone(JSON.parse(JSON.stringify(value)));
  } catch {
    throw new DomainInvariantError(`${field} must be JSON-compatible.`);
  }
}

export function copyCanonicalJsonValue(value: unknown, field: string): unknown {
  if (!isCanonicalJsonValue(value)) {
    throw new DomainInvariantError(`${field} must be JSON-compatible.`);
  }

  return freezeClone(value);
}
