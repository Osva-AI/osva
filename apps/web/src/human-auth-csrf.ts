import type { IncomingMessage } from "node:http";

export function assertTrustedOrigin(
  request: IncomingMessage,
  trustedOrigins: readonly string[],
): boolean {
  if (trustedOrigins.length === 0) {
    return false;
  }

  const origin = readHeader(request, "origin");
  if (origin !== undefined) {
    const normalized = normalizeOriginValue(origin);
    if (normalized === undefined) {
      return false;
    }
    return trustedOrigins.includes(normalized);
  }

  const referer = readHeader(request, "referer");
  if (referer === undefined) {
    return false;
  }

  try {
    const refererOrigin = new URL(referer).origin;
    if (!isAllowedScheme(refererOrigin)) {
      return false;
    }
    return trustedOrigins.includes(refererOrigin);
  } catch {
    return false;
  }
}

function normalizeOriginValue(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!isAllowedScheme(url.origin)) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function isAllowedScheme(origin: string): boolean {
  return origin.startsWith("http://") || origin.startsWith("https://");
}

function readHeader(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const raw = request.headers[name];
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  return undefined;
}
