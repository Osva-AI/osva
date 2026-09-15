export interface WebConfig {
  readonly databaseUrl: string;
  readonly valkeyUrl: string;
  readonly host: string;
  readonly port: number;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;

export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const databaseUrl = readRequired(env.OSVA_DATABASE_URL, "OSVA_DATABASE_URL");
  const valkeyUrl = readRequired(env.OSVA_VALKEY_URL, "OSVA_VALKEY_URL");
  const host = readOptional(env.OSVA_WEB_HOST) ?? DEFAULT_HOST;
  const port = parsePort(env.OSVA_WEB_PORT, DEFAULT_PORT);

  return { databaseUrl, valkeyUrl, host, port };
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
