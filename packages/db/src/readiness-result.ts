export const READINESS_DEPENDENCIES = ["postgres", "valkey"] as const;

export type ReadinessDependency = (typeof READINESS_DEPENDENCIES)[number];

export interface DependencyReadinessSnapshot {
  readonly ready: boolean;
  readonly failedDependencies: readonly ReadinessDependency[];
}

export class ReadinessUnavailableError extends Error {
  readonly failedDependencies: readonly ReadinessDependency[];

  constructor(failedDependencies: readonly ReadinessDependency[]) {
    super("Service is unavailable.");
    this.name = "ReadinessUnavailableError";
    this.failedDependencies = failedDependencies;
  }
}

export function readinessFailureBody(
  failedDependencies: readonly ReadinessDependency[] = [],
): {
  readonly status: "unavailable";
  readonly failedDependency?: ReadinessDependency;
  readonly failedDependencies?: readonly ReadinessDependency[];
} {
  if (failedDependencies.length === 0) {
    return { status: "unavailable" };
  }

  if (failedDependencies.length === 1) {
    return {
      status: "unavailable",
      failedDependency: failedDependencies[0],
    };
  }

  return {
    status: "unavailable",
    failedDependency: failedDependencies[0],
    failedDependencies,
  };
}

export async function collectDependencyReadiness(
  checks: readonly {
    readonly name: ReadinessDependency;
    readonly check: () => Promise<void>;
  }[],
): Promise<DependencyReadinessSnapshot> {
  const failedDependencies: ReadinessDependency[] = [];
  for (const entry of checks) {
    try {
      await entry.check();
    } catch {
      failedDependencies.push(entry.name);
    }
  }

  return {
    ready: failedDependencies.length === 0,
    failedDependencies,
  };
}

export async function assertPostgresAndValkeyReady(
  postgres: { ping(): Promise<void> },
  valkey: { ping(): Promise<void> },
  checkPostgres: (database: { ping(): Promise<void> }) => Promise<void>,
): Promise<void> {
  const snapshot = await collectDependencyReadiness([
    { name: "postgres", check: () => checkPostgres(postgres) },
    { name: "valkey", check: () => valkey.ping() },
  ]);
  if (!snapshot.ready) {
    throw new ReadinessUnavailableError(snapshot.failedDependencies);
  }
}
