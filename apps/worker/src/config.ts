export interface WorkerConfig {
  readonly databaseUrl: string;
}

export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const databaseUrl = env.OSVA_DATABASE_URL?.trim() ?? "";
  if (databaseUrl.length === 0) {
    throw new Error("OSVA_DATABASE_URL is required.");
  }

  return { databaseUrl };
}
