/** Must match control-plane session cookie name (`apps/web` human auth). */
export const OSVA_SESSION_COOKIE_NAME = "osva.session_token";

const ALLOWED_SET_COOKIE_ATTRIBUTES = new Set([
  "path",
  "httponly",
  "samesite",
  "secure",
  "max-age",
]);

export function readOsvaSessionCookieValue(
  cookieHeader: string | undefined,
): string | undefined {
  if (cookieHeader === undefined || cookieHeader.trim().length === 0) {
    return undefined;
  }

  for (const segment of cookieHeader.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed.toLowerCase().startsWith(`${OSVA_SESSION_COOKIE_NAME}=`)) {
      continue;
    }
    const rawValue = trimmed.slice(OSVA_SESSION_COOKIE_NAME.length + 1);
    if (rawValue.length === 0) {
      return undefined;
    }
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return undefined;
}

export function buildForwardSessionCookieHeader(
  cookieHeader: string | undefined,
): string | undefined {
  const value = readOsvaSessionCookieValue(cookieHeader);
  if (value === undefined) {
    return undefined;
  }
  return `${OSVA_SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`;
}

/**
 * Forwards only `osva.session_token` Set-Cookie lines and strips Domain so the
 * browser binds the session to the Console origin.
 */
export function sanitizeSessionSetCookieHeaders(
  setCookie: string | readonly string[] | null | undefined,
): readonly string[] {
  if (setCookie === null || setCookie === undefined) {
    return [];
  }

  const lines = typeof setCookie === "string" ? [setCookie] : [...setCookie];
  const sanitized: string[] = [];

  for (const line of lines) {
    const normalized = sanitizeSingleSessionSetCookie(line);
    if (normalized !== undefined) {
      sanitized.push(normalized);
    }
  }

  return sanitized;
}

function sanitizeSingleSessionSetCookie(line: string): string | undefined {
  const parts = line.split(";").map((part) => part.trim());
  if (parts.length === 0) {
    return undefined;
  }

  const [nameValue, ...attributes] = parts;
  if (
    nameValue === undefined ||
    !nameValue.toLowerCase().startsWith(`${OSVA_SESSION_COOKIE_NAME}=`)
  ) {
    return undefined;
  }

  const keptAttributes: string[] = [];
  for (const attribute of attributes) {
    const lower = attribute.toLowerCase();
    const key = lower.split("=")[0]?.trim() ?? "";
    if (key === "domain") {
      continue;
    }
    if (ALLOWED_SET_COOKIE_ATTRIBUTES.has(key)) {
      keptAttributes.push(attribute);
    }
  }

  if (!keptAttributes.some((attr) => attr.toLowerCase().startsWith("path="))) {
    keptAttributes.unshift("Path=/");
  }

  return [nameValue, ...keptAttributes].join("; ");
}

export function appendSanitizedSetCookies(
  response: import("node:http").ServerResponse,
  setCookie: string | readonly string[] | null | undefined,
): void {
  appendSessionSetCookieLines(
    response,
    sanitizeSessionSetCookieHeaders(setCookie),
  );
}

export function appendSessionSetCookieLines(
  response: import("node:http").ServerResponse,
  setCookieLines: readonly string[],
): void {
  for (const cookie of setCookieLines) {
    response.appendHeader("set-cookie", cookie);
  }
}
