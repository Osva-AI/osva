export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly valkeyUrl: string;
  readonly trustedRuntimeRoot?: string;
}

export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const databaseUrl = readRequired(env.OSVA_DATABASE_URL, "OSVA_DATABASE_URL");
  const valkeyUrl = readRequired(env.OSVA_VALKEY_URL, "OSVA_VALKEY_URL");
  const trustedRuntimeRoot = env.OSVA_TRUSTED_RUNTIME_ROOT?.trim();
  return {
    databaseUrl,
    valkeyUrl,
    trustedRuntimeRoot:
      trustedRuntimeRoot === undefined || trustedRuntimeRoot.length === 0
        ? undefined
        : trustedRuntimeRoot,
  };
}

function readRequired(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return trimmed;
}
