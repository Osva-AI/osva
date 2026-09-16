const DEFAULT_POLL_MS = 1_000;
const MIN_POLL_MS = 100;
const MAX_POLL_MS = 60_000;

export interface SchedulerConfig {
  readonly databaseUrl: string;
  readonly valkeyUrl: string;
  readonly pollMs: number;
}

export function loadSchedulerConfig(
  env: NodeJS.ProcessEnv = process.env,
): SchedulerConfig {
  const databaseUrl = readRequired(env.OSVA_DATABASE_URL, "OSVA_DATABASE_URL");
  const valkeyUrl = readRequired(env.OSVA_VALKEY_URL, "OSVA_VALKEY_URL");
  const pollMs = readPollMs(env.OSVA_SCHEDULER_POLL_MS);

  return {
    databaseUrl,
    valkeyUrl,
    pollMs,
  };
}

function readPollMs(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_POLL_MS;
  }

  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_POLL_MS ||
    parsed > MAX_POLL_MS
  ) {
    throw new Error(
      `OSVA_SCHEDULER_POLL_MS must be an integer between ${String(MIN_POLL_MS)} and ${String(MAX_POLL_MS)}.`,
    );
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
