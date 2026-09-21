import {
  resolveContainerCapabilityBaseUrl,
  validateContainerCapabilityBaseUrl,
  type ContainerResourcePolicy,
} from "@osva/adapters-runtime-container";

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
  readonly mcpStdioConnectorsEnabled: boolean;
  readonly mcpConnectorAllowPrivateNetworks: boolean;
  readonly containerEnabled: boolean;
  readonly containerNetworkMode: string;
  readonly containerCapabilityBaseUrl?: string;
  readonly containerResourcePolicy?: ContainerResourcePolicy;
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
  const containerCapabilityBaseUrl =
    env.OSVA_CONTAINER_CAPABILITY_BASE_URL?.trim();
  const containerEnabled = readOptionalBoolean(
    env.OSVA_CONTAINER_ENABLED,
    "OSVA_CONTAINER_ENABLED",
  );
  const containerNetworkMode =
    env.OSVA_CONTAINER_NETWORK_MODE?.trim() || "bridge";
  if (
    containerEnabled &&
    (containerNetworkMode === "host" || containerNetworkMode === "none")
  ) {
    throw new Error(
      "OSVA_CONTAINER_NETWORK_MODE must not be host or none when container execution is enabled.",
    );
  }

  const config: WorkerConfig = {
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
    mcpStdioConnectorsEnabled: readOptionalBoolean(
      env.OSVA_MCP_STDIO_CONNECTORS_ENABLED,
      "OSVA_MCP_STDIO_CONNECTORS_ENABLED",
    ),
    mcpConnectorAllowPrivateNetworks: readOptionalBoolean(
      env.OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS,
      "OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS",
    ),
    containerEnabled,
    containerNetworkMode,
    containerCapabilityBaseUrl:
      containerCapabilityBaseUrl === undefined ||
      containerCapabilityBaseUrl.length === 0
        ? undefined
        : containerCapabilityBaseUrl,
    containerResourcePolicy: containerEnabled
      ? readContainerResourcePolicy(env)
      : undefined,
  };

  if (config.containerEnabled && config.runtimeCapabilitySecret !== undefined) {
    const explicitCapabilityBaseUrl = resolveContainerCapabilityBaseUrl({
      containerCapabilityBaseUrl: config.containerCapabilityBaseUrl,
      runtimeCapabilityBaseUrl: config.runtimeCapabilityBaseUrl,
    });
    if (explicitCapabilityBaseUrl !== undefined) {
      validateContainerCapabilityBaseUrl(
        explicitCapabilityBaseUrl,
        config.containerNetworkMode,
      );
    }
  }

  return config;
}

function readContainerResourcePolicy(
  env: NodeJS.ProcessEnv,
): ContainerResourcePolicy {
  return {
    defaults: {
      cpuMillis: readPositiveInt(
        env.OSVA_CONTAINER_DEFAULT_CPU_MILLIS,
        500,
        "OSVA_CONTAINER_DEFAULT_CPU_MILLIS",
      ),
      memoryMiB: readPositiveInt(
        env.OSVA_CONTAINER_DEFAULT_MEMORY_MIB,
        256,
        "OSVA_CONTAINER_DEFAULT_MEMORY_MIB",
      ),
      pids: readPositiveInt(
        env.OSVA_CONTAINER_DEFAULT_PIDS,
        128,
        "OSVA_CONTAINER_DEFAULT_PIDS",
      ),
    },
    maximums: {
      cpuMillis: readPositiveInt(
        env.OSVA_CONTAINER_MAX_CPU_MILLIS,
        2_000,
        "OSVA_CONTAINER_MAX_CPU_MILLIS",
      ),
      memoryMiB: readPositiveInt(
        env.OSVA_CONTAINER_MAX_MEMORY_MIB,
        1_024,
        "OSVA_CONTAINER_MAX_MEMORY_MIB",
      ),
      pids: readPositiveInt(
        env.OSVA_CONTAINER_MAX_PIDS,
        512,
        "OSVA_CONTAINER_MAX_PIDS",
      ),
    },
  };
}

function readPositiveInt(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
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
