import path from "node:path";

import { packageRootDir } from "./constants.js";

export type TrustedRuntimeDeployMode = "host" | "compose";

export interface HelloEnv {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly deployMode: TrustedRuntimeDeployMode;
  readonly trustedRuntimeRoot: string | undefined;
  readonly composeDir: string;
  readonly composeProject: string | undefined;
  readonly composeProjectNameEnv: string | undefined;
  readonly runPollIntervalMs: number;
  readonly runPollTimeoutMs: number;
  readonly message: string;
}

export class HelloConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HelloConfigurationError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new HelloConfigurationError(
      `Missing ${name}. Export it before running the Hello Agent golden path.`,
    );
  }
  return value;
}

function parseDeployMode(raw: string | undefined): TrustedRuntimeDeployMode {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) {
    return process.env.OSVA_TRUSTED_RUNTIME_ROOT?.trim() ? "host" : "compose";
  }
  if (normalized === "host" || normalized === "compose") {
    return normalized;
  }
  throw new HelloConfigurationError(
    `Invalid OSVA_HELLO_TRUSTED_RUNTIME_MODE '${raw}'. Expected 'host' or 'compose'.`,
  );
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HelloConfigurationError(
      `Invalid ${name} '${raw}'. Expected a positive integer.`,
    );
  }
  return parsed;
}

export function loadHelloEnv(): HelloEnv {
  const deployMode = parseDeployMode(
    process.env.OSVA_HELLO_TRUSTED_RUNTIME_MODE,
  );
  const trustedRuntimeRoot = process.env.OSVA_TRUSTED_RUNTIME_ROOT?.trim();
  if (deployMode === "host") {
    if (trustedRuntimeRoot === undefined || trustedRuntimeRoot.length === 0) {
      throw new HelloConfigurationError(
        "Host deploy mode requires OSVA_TRUSTED_RUNTIME_ROOT pointing at the directory your worker reads.",
      );
    }
  }

  const message = process.env.OSVA_HELLO_MESSAGE?.trim() ?? "Hello OSVA";

  return {
    baseUrl: requireEnv("OSVA_BASE_URL"),
    apiKey: requireEnv("OSVA_API_KEY"),
    workspaceId: requireEnv("OSVA_WORKSPACE_ID"),
    deployMode,
    trustedRuntimeRoot:
      trustedRuntimeRoot === undefined || trustedRuntimeRoot.length === 0
        ? undefined
        : trustedRuntimeRoot,
    composeDir:
      process.env.OSVA_COMPOSE_DIR?.trim() ??
      path.resolve(packageRootDir, "../../deploy/compose"),
    composeProject: process.env.OSVA_COMPOSE_PROJECT?.trim(),
    composeProjectNameEnv: process.env.COMPOSE_PROJECT_NAME?.trim(),
    runPollIntervalMs: parsePositiveInt(
      process.env.OSVA_HELLO_RUN_POLL_INTERVAL_MS,
      500,
      "OSVA_HELLO_RUN_POLL_INTERVAL_MS",
    ),
    runPollTimeoutMs: parsePositiveInt(
      process.env.OSVA_HELLO_RUN_POLL_TIMEOUT_MS,
      120_000,
      "OSVA_HELLO_RUN_POLL_TIMEOUT_MS",
    ),
    message,
  };
}
