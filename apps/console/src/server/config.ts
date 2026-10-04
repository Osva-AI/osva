import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ConsoleConfig {
  readonly osvaBaseUrl: string;
  readonly osvaApiKey: string;
  readonly host: string;
  readonly port: number;
  readonly clientDistDir: string;
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
  const osvaApiKey = readOptional(env.OSVA_CONSOLE_API_KEY);
  if (osvaApiKey === undefined) {
    throw new ConsoleConfigurationError(
      "OSVA_CONSOLE_API_KEY is required to run the OSVA console.",
    );
  }

  const host = readOptional(env.OSVA_CONSOLE_HOST) ?? DEFAULT_HOST;
  const port = parsePort(env.OSVA_CONSOLE_PORT, DEFAULT_PORT);
  const clientDistDir =
    readOptional(env.OSVA_CONSOLE_CLIENT_DIST) ?? defaultClientDistDir();

  return {
    osvaBaseUrl,
    osvaApiKey,
    host,
    port,
    clientDistDir,
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
  return path.resolve(serverDir, "../../client");
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
