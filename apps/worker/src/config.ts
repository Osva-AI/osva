export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly valkeyUrl: string;
  readonly trustedRuntimeRoot?: string;
  readonly runtimeCapabilitySecret?: string;
  readonly runtimeCapabilityHost: string;
  readonly runtimeCapabilityPort: number;
  readonly runtimeCapabilityBaseUrl?: string;
  /**
   * Operator-only opt-in for REMOTE_HTTP private/loopback destinations.
   * AgentVersion configuration cannot enable this.
   */
  readonly remoteHttpAllowPrivateNetworks: boolean;
}

export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const databaseUrl = readRequired(env.OSVA_DATABASE_URL, "OSVA_DATABASE_URL");
  const valkeyUrl = readRequired(env.OSVA_VALKEY_URL, "OSVA_VALKEY_URL");
  const trustedRuntimeRoot = env.OSVA_TRUSTED_RUNTIME_ROOT?.trim();
  const runtimeCapabilitySecret = env.OSVA_RUNTIME_CAPABILITY_SECRET?.trim();
  const runtimeCapabilityHost =
    env.OSVA_RUNTIME_CAPABILITY_HOST?.trim() || "127.0.0.1";
  const runtimeCapabilityBaseUrl = env.OSVA_RUNTIME_CAPABILITY_BASE_URL?.trim();
  return {
    databaseUrl,
    valkeyUrl,
    trustedRuntimeRoot:
      trustedRuntimeRoot === undefined || trustedRuntimeRoot.length === 0
        ? undefined
        : trustedRuntimeRoot,
    runtimeCapabilitySecret:
      runtimeCapabilitySecret === undefined ||
      runtimeCapabilitySecret.length === 0
        ? undefined
        : runtimeCapabilitySecret,
    runtimeCapabilityHost,
    runtimeCapabilityPort: readPort(
      env.OSVA_RUNTIME_CAPABILITY_PORT,
      "OSVA_RUNTIME_CAPABILITY_PORT",
    ),
    runtimeCapabilityBaseUrl:
      runtimeCapabilityBaseUrl === undefined ||
      runtimeCapabilityBaseUrl.length === 0
        ? undefined
        : runtimeCapabilityBaseUrl,
    remoteHttpAllowPrivateNetworks: readOptionalBoolean(
      env.OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS,
      "OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS",
    ),
  };
}

function readRequired(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return trimmed;
}

function readPort(value: string | undefined, name: string): number {
  if (value === undefined || value.trim().length === 0) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`${name} must be an integer between 0 and 65535.`);
  }

  return parsed;
}

function readOptionalBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value.trim().length === 0) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }

  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
}
