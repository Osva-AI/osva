import type { IncomingMessage } from "node:http";

import { isLoopbackBindHost, normalizeBindHost } from "./loopback.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type ConsoleRequestGuardDenialReason =
  "forwarded_host" | "invalid_host" | "cross_site_mutation" | "invalid_origin";

export type ConsoleRequestGuardResult =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly status: number;
      readonly code: "invalid_host" | "invalid_origin";
      readonly reason: ConsoleRequestGuardDenialReason;
      readonly error: string;
    };

export interface ConsoleRequestGuardOptions {
  readonly allowedOrigins: readonly string[];
}

export function evaluateConsoleApiRequestGuard(
  request: IncomingMessage,
  options: ConsoleRequestGuardOptions,
): ConsoleRequestGuardResult {
  const forwardedHost = headerValue(request.headers["x-forwarded-host"]);
  const forwardedProto = headerValue(request.headers["x-forwarded-proto"]);
  if (forwardedHost !== undefined || forwardedProto !== undefined) {
    return denied(
      "invalid_host",
      "forwarded_host",
      "Forwarded host headers are not trusted by the OSVA console.",
    );
  }

  const host = parseHostHeader(headerValue(request.headers.host));
  if (host === undefined || !isLoopbackBindHost(host.hostname)) {
    return denied(
      "invalid_host",
      "invalid_host",
      "Console API Host must be a loopback address.",
    );
  }

  const method = (request.method ?? "GET").toUpperCase();
  if (!MUTATING_METHODS.has(method)) {
    return { allowed: true };
  }

  const fetchSite = headerValue(request.headers["sec-fetch-site"]);
  if (fetchSite !== undefined && isCrossSiteFetch(fetchSite)) {
    return denied(
      "invalid_origin",
      "cross_site_mutation",
      "Cross-site Console API mutations are not allowed.",
    );
  }

  const origin = headerValue(request.headers.origin);
  if (origin === undefined) {
    return { allowed: true };
  }

  if (!isAllowedConsoleOrigin(origin, options.allowedOrigins)) {
    return denied(
      "invalid_origin",
      "invalid_origin",
      "Cross-origin Console API mutations are not allowed.",
    );
  }

  return { allowed: true };
}

export function isAllowedConsoleOrigin(
  origin: string,
  allowedOrigins: readonly string[],
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  const hostname = normalizeBindHost(parsed.hostname);
  if (hostname !== undefined && isLoopbackBindHost(hostname)) {
    return true;
  }

  const canonical = canonicalOrigin(parsed);
  return allowedOrigins.some((allowed) => allowed === canonical);
}

export function parseAllowedConsoleOrigins(
  raw: string | undefined,
): readonly string[] {
  const trimmed = raw?.trim() ?? "";
  if (trimmed.length === 0) {
    return [];
  }

  const origins: string[] = [];
  for (const segment of trimmed.split(",")) {
    const value = segment.trim();
    if (value.length === 0) {
      continue;
    }
    if (value === "*" || value.includes("*")) {
      throw new Error(
        "OSVA_CONSOLE_ALLOWED_ORIGINS must not contain wildcards; list explicit http(s) origins.",
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(
        "OSVA_CONSOLE_ALLOWED_ORIGINS must be a comma-separated list of absolute http(s) origins.",
      );
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        "OSVA_CONSOLE_ALLOWED_ORIGINS must use http or https origins.",
      );
    }

    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new Error(
        "OSVA_CONSOLE_ALLOWED_ORIGINS entries must be bare origins (scheme, host, optional port).",
      );
    }

    const canonical = canonicalOrigin(parsed);
    if (!origins.includes(canonical)) {
      origins.push(canonical);
    }
  }

  return origins;
}

export function parseHostHeader(
  host: string | undefined,
): { readonly hostname: string } | undefined {
  if (host === undefined) {
    return undefined;
  }

  const trimmed = host.trim().toLowerCase();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (trimmed.startsWith("[")) {
    const closing = trimmed.indexOf("]");
    if (closing <= 1) {
      return undefined;
    }
    return { hostname: trimmed.slice(1, closing) };
  }

  const colon = trimmed.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(trimmed.slice(colon + 1))) {
    return { hostname: trimmed.slice(0, colon) };
  }

  return { hostname: trimmed };
}

function canonicalOrigin(url: URL): string {
  return `${url.protocol}//${url.host}`.toLowerCase();
}

function isCrossSiteFetch(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "cross-site" || normalized === "same-site";
}

function denied(
  code: "invalid_host" | "invalid_origin",
  reason: ConsoleRequestGuardDenialReason,
  error: string,
): ConsoleRequestGuardResult {
  return { allowed: false, status: 403, code, reason, error };
}

function headerValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = typeof value === "string" ? value : value[0];
  const trimmed = raw?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}
