export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly valkeyUrl: string;
}

export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const databaseUrl = readRequired(env.OSVA_DATABASE_URL, "OSVA_DATABASE_URL");
  const valkeyUrl = readRequired(env.OSVA_VALKEY_URL, "OSVA_VALKEY_URL");
  return { databaseUrl, valkeyUrl };
}

function readRequired(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return trimmed;
}
