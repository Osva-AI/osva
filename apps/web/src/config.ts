import {
  OSVA_AUTHENTICATED_RATE_LIMIT_PER_MINUTE,
  OSVA_UNAUTHENTICATED_RATE_LIMIT_PER_MINUTE,
} from "@osva-ai/contracts";

import { parseTrustedProxyCidrs } from "./client-ip.js";

export interface WebConfig {
  readonly databaseUrl: string;
  readonly valkeyUrl: string;
  readonly host: string;
  readonly port: number;
  readonly unauthenticatedRateLimitPerMinute: number;
  readonly authenticatedRateLimitPerMinute: number;
  readonly trustedProxies: readonly string[];
  readonly authSecret: string;
  readonly authBaseUrl: string;
  readonly authTrustedOrigins: readonly string[];
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;

export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const databaseUrl = readRequired(env.OSVA_DATABASE_URL, "OSVA_DATABASE_URL");
  const valkeyUrl = readRequired(env.OSVA_VALKEY_URL, "OSVA_VALKEY_URL");
  const host = readOptional(env.OSVA_WEB_HOST) ?? DEFAULT_HOST;
  const port = parsePort(env.OSVA_WEB_PORT, DEFAULT_PORT);

  const authSecret = readRequired(env.OSVA_AUTH_SECRET, "OSVA_AUTH_SECRET");
  if (authSecret.length < 32) {
    throw new Error("OSVA_AUTH_SECRET must be at least 32 characters.");
  }

  const authBaseUrl = validateAuthBaseUrl(
    readOptional(env.OSVA_AUTH_BASE_URL) ?? `http://${host}:${String(port)}`,
  );
  const authTrustedOrigins = parseTrustedOrigins(
    env.OSVA_AUTH_TRUSTED_ORIGINS,
    authBaseUrl,
  );

  return {
    databaseUrl,
    valkeyUrl,
    host,
    port,
    authSecret,
    authBaseUrl,
    authTrustedOrigins,
    unauthenticatedRateLimitPerMinute: parsePositiveInt(
      env.OSVA_RATE_LIMIT_UNAUTH_PER_MINUTE,
      OSVA_UNAUTHENTICATED_RATE_LIMIT_PER_MINUTE,
      "OSVA_RATE_LIMIT_UNAUTH_PER_MINUTE",
    ),
    authenticatedRateLimitPerMinute: parsePositiveInt(
      env.OSVA_RATE_LIMIT_AUTH_PER_MINUTE,
      OSVA_AUTHENTICATED_RATE_LIMIT_PER_MINUTE,
      "OSVA_RATE_LIMIT_AUTH_PER_MINUTE",
    ),
    trustedProxies: parseTrustedProxyCidrs(env.OSVA_TRUSTED_PROXIES),
  };
}

function readRequired(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return trimmed;
}

function readOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return fallback;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function validateAuthBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("OSVA_AUTH_BASE_URL must be a valid absolute URL.");
  }
  assertAllowedAuthUrl(url, "OSVA_AUTH_BASE_URL");
  return value.trim();
}

function parseTrustedOrigins(
  value: string | undefined,
  authBaseUrl: string,
): readonly string[] {
  const baseOrigin = new URL(authBaseUrl).origin;
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return [baseOrigin];
  }

  const origins = new Set<string>();
  for (const segment of trimmed.split(",")) {
    const entry = segment.trim();
    if (entry.length === 0) {
      continue;
    }
    origins.add(parseTrustedOriginEntry(entry));
  }

  if (origins.size === 0) {
    throw new Error(
      "OSVA_AUTH_TRUSTED_ORIGINS must include at least one valid origin.",
    );
  }

  return [...origins];
}

function parseTrustedOriginEntry(entry: string): string {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw new Error(
      "OSVA_AUTH_TRUSTED_ORIGINS entries must be valid absolute URLs.",
    );
  }
  assertAllowedAuthUrl(url, "OSVA_AUTH_TRUSTED_ORIGINS");
  return url.origin;
}

function assertAllowedAuthUrl(url: URL, fieldName: string): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${fieldName} must use http or https.`);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(`${fieldName} must not include user credentials.`);
  }
  if (url.hostname.includes("*")) {
    throw new Error(`${fieldName} must not use wildcard hostnames.`);
  }
}

function parsePort(value: string | undefined, fallback: number): number {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return fallback;
  }

  if (!/^\d+$/.test(trimmed)) {
    throw new Error("OSVA_WEB_PORT must be an integer between 0 and 65535.");
  }

  const port = Number.parseInt(trimmed, 10);
  if (port < 0 || port > 65535) {
    throw new Error("OSVA_WEB_PORT must be an integer between 0 and 65535.");
  }

  return port;
}
