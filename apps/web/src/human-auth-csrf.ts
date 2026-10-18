import type { IncomingMessage } from "node:http";

export function assertTrustedOrigin(
  request: IncomingMessage,
  trustedOrigins: readonly string[],
): boolean {
  if (trustedOrigins.length === 0) {
    return true;
  }

  const origin = readHeader(request, "origin");
  if (origin !== undefined && trustedOrigins.includes(origin)) {
    return true;
  }

  const referer = readHeader(request, "referer");
  if (referer === undefined) {
    return false;
  }

  try {
    const refererOrigin = new URL(referer).origin;
    return trustedOrigins.includes(refererOrigin);
  } catch {
    return false;
  }
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
