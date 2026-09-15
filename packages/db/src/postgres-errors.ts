import { DomainInvariantError } from "@osva/domain";

export const POSTGRES_UNIQUE_VIOLATION = "23505";
export const POSTGRES_FOREIGN_KEY_VIOLATION = "23503";
export const POSTGRES_CHECK_VIOLATION = "23514";

interface PostgresJsError {
  readonly code?: string;
  readonly constraint_name?: string;
  readonly constraint?: string;
}

function isSqlState(code: unknown): code is string {
  return typeof code === "string" && /^\d{5}$/.test(code);
}

function asPostgresJsError(error: unknown): PostgresJsError | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const candidate = error as PostgresJsError;
  if (isSqlState(candidate.code)) {
    return candidate;
  }

  return undefined;
}

function unwrapPostgresError(error: unknown): PostgresJsError | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const matched = asPostgresJsError(current);
    if (matched) {
      return matched;
    }

    current =
      "cause" in current ? (current as { cause: unknown }).cause : undefined;
  }

  return undefined;
}

export function postgresConstraintName(error: unknown): string | undefined {
  const postgresError = unwrapPostgresError(error);
  return postgresError?.constraint_name ?? postgresError?.constraint;
}

export function postgresErrorCode(error: unknown): string | undefined {
  return unwrapPostgresError(error)?.code;
}

export function mapDatabaseError(
  error: unknown,
  messages: Readonly<Record<string, string>> = {},
): unknown {
  const code = postgresErrorCode(error);
  const constraint = postgresConstraintName(error);

  if (code === POSTGRES_UNIQUE_VIOLATION) {
    if (constraint && constraint in messages) {
      return new DomainInvariantError(messages[constraint] ?? constraint);
    }

    return new DomainInvariantError(
      constraint
        ? `Unique constraint '${constraint}' was violated.`
        : "A unique constraint was violated.",
    );
  }

  if (code === POSTGRES_FOREIGN_KEY_VIOLATION) {
    if (constraint && constraint in messages) {
      return new DomainInvariantError(messages[constraint] ?? constraint);
    }

    return new DomainInvariantError(
      constraint
        ? `Foreign key '${constraint}' was violated.`
        : "A foreign key constraint was violated.",
    );
  }

  if (code === POSTGRES_CHECK_VIOLATION) {
    if (constraint && constraint in messages) {
      return new DomainInvariantError(messages[constraint] ?? constraint);
    }

    return new DomainInvariantError(
      constraint
        ? `Check constraint '${constraint}' was violated.`
        : "A check constraint was violated.",
    );
  }

  return error;
}

export async function withMappedDatabaseErrors<T>(
  operation: () => Promise<T>,
  messages?: Readonly<Record<string, string>>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapDatabaseError(error, messages);
  }
}
