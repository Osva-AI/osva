import path from "node:path";
import { fileURLToPath } from "node:url";

import { isLoopbackBindHost } from "./loopback.js";
import { parseAllowedConsoleOrigins } from "./request-guard.js";

export interface ConsoleConfig {
  readonly osvaBaseUrl: string;
  /** Deprecated server-side API key mode; disabled unless legacy flag is set. */
  readonly osvaApiKey?: string;
  readonly legacyApiKeyMode: boolean;
  readonly host: string;
  readonly port: number;
  readonly clientDistDir: string;
  readonly allowedOrigins: readonly string[];
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4174;
const DEFAULT_OSVA_BASE_URL = "http://127.0.0.1:3000";

export class ConsoleConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsoleConfigurationError";
  }
}

export function loadConsoleConfig(
  env: NodeJS.ProcessEnv = process.env,
): ConsoleConfig {
  const osvaBaseUrl =
    readOptional(env.OSVA_BASE_URL) ??
    readOptional(env.OSVA_API_BASE_URL) ??
    DEFAULT_OSVA_BASE_URL;
  const legacyApiKeyMode =
    readOptionalBoolean(env.OSVA_CONSOLE_LEGACY_API_KEY_MODE) ?? false;
  const osvaApiKey = readOptional(env.OSVA_CONSOLE_API_KEY);
  if (legacyApiKeyMode && osvaApiKey === undefined) {
    throw new ConsoleConfigurationError(
      "OSVA_CONSOLE_LEGACY_API_KEY_MODE requires OSVA_CONSOLE_API_KEY.",
    );
  }

  const host = readOptional(env.OSVA_CONSOLE_HOST) ?? DEFAULT_HOST;
  assertConsoleBindHost(host, env);
  const port = parsePort(env.OSVA_CONSOLE_PORT, DEFAULT_PORT);
  const clientDistDir =
    readOptional(env.OSVA_CONSOLE_CLIENT_DIST) ?? defaultClientDistDir();
  let allowedOrigins: readonly string[];
  try {
    allowedOrigins = parseAllowedConsoleOrigins(
      env.OSVA_CONSOLE_ALLOWED_ORIGINS,
    );
  } catch (error) {
    throw new ConsoleConfigurationError(
      error instanceof Error
        ? error.message
        : "Invalid OSVA_CONSOLE_ALLOWED_ORIGINS.",
    );
  }

  return {
    osvaBaseUrl,
    ...(osvaApiKey === undefined ? {} : { osvaApiKey }),
    legacyApiKeyMode,
    host,
    port,
    clientDistDir,
    allowedOrigins,
  };
}

export function tryLoadConsoleConfig(
  env: NodeJS.ProcessEnv = process.env,
): ConsoleConfig | undefined {
  try {
    return loadConsoleConfig(env);
  } catch (error) {
    if (error instanceof ConsoleConfigurationError) {
      return undefined;
    }
    throw error;
  }
}

export function defaultClientDistDir(): string {
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(serverDir, "../client");
}

function assertConsoleBindHost(host: string, env: NodeJS.ProcessEnv): void {
  if (isLoopbackBindHost(host)) {
    return;
  }

  const publicBindFlag = readOptionalBoolean(
    env.OSVA_CONSOLE_ALLOW_PUBLIC_BIND,
  );
  if (publicBindFlag === true) {
    throw new ConsoleConfigurationError(
      "OSVA_CONSOLE_HOST must be a loopback address. OSVA_CONSOLE_ALLOW_PUBLIC_BIND is deprecated and does not enable public Console binding or authentication. Use an SSH tunnel or an authenticating reverse proxy to the loopback listener.",
    );
  }

  throw new ConsoleConfigurationError(
    "OSVA_CONSOLE_HOST must be a loopback address (127.0.0.0/8, ::1, or localhost). Remote access requires a secure tunnel or an authenticating reverse proxy in front of the loopback listener. OSVA_CONSOLE_ALLOW_PUBLIC_BIND does not provide access control.",
  );
}

function readOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }

  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  throw new ConsoleConfigurationError(
    "OSVA_CONSOLE_ALLOW_PUBLIC_BIND must be true or false.",
  );
}

function readOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}

function parsePort(value: string | undefined, fallback: number): number {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return fallback;
  }

  if (!/^\d+$/.test(trimmed)) {
    throw new ConsoleConfigurationError(
      "OSVA_CONSOLE_PORT must be an integer between 0 and 65535.",
    );
  }

  const port = Number.parseInt(trimmed, 10);
  if (port < 0 || port > 65535) {
    throw new ConsoleConfigurationError(
      "OSVA_CONSOLE_PORT must be an integer between 0 and 65535.",
    );
  }

  return port;
}
