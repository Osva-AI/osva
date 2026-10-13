import {
  checkDatabaseConnection,
  collectDependencyReadiness,
  type Database,
  type DependencyReadinessSnapshot,
} from "@osva/db";

import type { PingableJobQueue } from "@osva/adapters-bullmq";

import type { ReadinessCheck } from "./http.js";

export function postgresReadinessCheck(
  database: Pick<Database, "ping">,
): ReadinessCheck {
  return async () => {
    const snapshot = await collectDependencyReadiness([
      {
        name: "postgres",
        check: () => checkDatabaseConnection(database),
      },
    ]);
    return toReadinessResult(snapshot);
  };
}

export function postgresAndValkeyReadinessCheck(
  database: Pick<Database, "ping">,
  queue: Pick<PingableJobQueue, "ping">,
): ReadinessCheck {
  return async () => {
    const snapshot = await collectDependencyReadiness([
      {
        name: "postgres",
        check: () => checkDatabaseConnection(database),
      },
      {
        name: "valkey",
        check: () => queue.ping(),
      },
    ]);
    return toReadinessResult(snapshot);
  };
}

function toReadinessResult(
  snapshot: DependencyReadinessSnapshot,
): boolean | DependencyReadinessSnapshot {
  return snapshot;
}
