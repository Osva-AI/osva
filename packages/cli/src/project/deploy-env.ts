import { ProjectConfigurationError } from "./errors.js";

export type TrustedRuntimeDeployMode = "host" | "compose";

export interface ProjectDeployEnv {
  readonly deployMode: TrustedRuntimeDeployMode;
  readonly trustedRuntimeRoot: string | undefined;
  readonly composeDir: string | undefined;
  readonly composeProject: string | undefined;
  readonly composeProjectNameEnv: string | undefined;
  readonly runPollIntervalMs: number;
  readonly runPollTimeoutMs: number;
}

function parseDeployMode(raw: string | undefined): TrustedRuntimeDeployMode {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) {
    return process.env.OSVA_TRUSTED_RUNTIME_ROOT?.trim() ? "host" : "compose";
  }
  if (normalized === "host" || normalized === "compose") {
    return normalized;
  }
  throw new ProjectConfigurationError(
    `Invalid OSVA_TRUSTED_RUNTIME_MODE '${raw}'. Expected 'host' or 'compose'.`,
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
    throw new ProjectConfigurationError(
      `Invalid ${name} '${raw}'. Expected a positive integer.`,
    );
  }
  return parsed;
}

export function loadProjectDeployEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProjectDeployEnv {
  const deployMode = parseDeployMode(env.OSVA_TRUSTED_RUNTIME_MODE);
  const trustedRuntimeRoot = env.OSVA_TRUSTED_RUNTIME_ROOT?.trim();
  if (deployMode === "host") {
    if (trustedRuntimeRoot === undefined || trustedRuntimeRoot.length === 0) {
      throw new ProjectConfigurationError(
        "Host deploy mode requires OSVA_TRUSTED_RUNTIME_ROOT pointing at the directory your worker reads.",
      );
    }
  }

  const composeDir = env.OSVA_COMPOSE_DIR?.trim();
  if (deployMode === "compose") {
    if (composeDir === undefined || composeDir.length === 0) {
      throw new ProjectConfigurationError(
        "Compose deploy mode requires OSVA_COMPOSE_DIR pointing at your deploy/compose directory.",
      );
    }
  }

  return {
    deployMode,
    trustedRuntimeRoot:
      trustedRuntimeRoot === undefined || trustedRuntimeRoot.length === 0
        ? undefined
        : trustedRuntimeRoot,
    composeDir:
      composeDir === undefined || composeDir.length === 0
        ? undefined
        : composeDir,
    composeProject: env.OSVA_COMPOSE_PROJECT?.trim(),
    composeProjectNameEnv: env.COMPOSE_PROJECT_NAME?.trim(),
    runPollIntervalMs: parsePositiveInt(
      env.OSVA_RUN_POLL_INTERVAL_MS,
      500,
      "OSVA_RUN_POLL_INTERVAL_MS",
    ),
    runPollTimeoutMs: parsePositiveInt(
      env.OSVA_RUN_POLL_TIMEOUT_MS,
      120_000,
      "OSVA_RUN_POLL_TIMEOUT_MS",
    ),
  };
}
