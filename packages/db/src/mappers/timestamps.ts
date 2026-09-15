import { DomainInvariantError } from "@osva/domain";

export function toDomainDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DomainInvariantError("Persisted timestamp must be a valid Date.");
  }

  return new Date(value.getTime());
}

export function toOptionalDomainDate(value: Date | null): Date | undefined {
  return value === null ? undefined : toDomainDate(value);
}
