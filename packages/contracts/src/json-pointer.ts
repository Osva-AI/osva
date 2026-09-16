/**
 * RFC 6901 JSON Pointer helpers.
 *
 * Used by Workflow Definition V2 BRANCH selectors. Missing paths are a
 * non-match, not an exception.
 */
export function isValidJsonPointer(pointer: string): boolean {
  if (pointer === "") {
    return true;
  }

  if (!pointer.startsWith("/")) {
    return false;
  }

  const tokens = pointer.slice(1).split("/");
  return tokens.every(isValidJsonPointerToken);
}

export interface JsonPointerResolution {
  readonly found: boolean;
  readonly value?: unknown;
}

export function resolveJsonPointer(
  document: unknown,
  pointer: string,
): JsonPointerResolution {
  if (!isValidJsonPointer(pointer)) {
    return { found: false };
  }

  if (pointer === "") {
    return { found: true, value: document };
  }

  let current: unknown = document;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = decodeJsonPointerToken(rawToken);
    if (Array.isArray(current)) {
      if (!isArrayIndexToken(token)) {
        return { found: false };
      }

      const index = Number(token);
      if (index >= current.length) {
        return { found: false };
      }

      current = current[index];
      continue;
    }

    if (current === null || typeof current !== "object") {
      return { found: false };
    }

    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, token)) {
      return { found: false };
    }

    current = record[token];
  }

  return { found: true, value: current };
}

function isValidJsonPointerToken(token: string): boolean {
  for (let index = 0; index < token.length; index += 1) {
    if (token[index] !== "~") {
      continue;
    }

    const next = token[index + 1];
    if (next !== "0" && next !== "1") {
      return false;
    }

    index += 1;
  }

  return true;
}

function decodeJsonPointerToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function isArrayIndexToken(token: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(token);
}
