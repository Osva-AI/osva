import { checkDatabaseConnection, type Database } from "@osva/db";

import type { PingableJobQueue } from "@osva/adapters-bullmq";

import type { ReadinessCheck } from "./http.js";

export function postgresReadinessCheck(
  database: Pick<Database, "ping">,
): ReadinessCheck {
  return async () => {
    try {
      await checkDatabaseConnection(database);
      return true;
    } catch {
      return false;
    }
  };
}

export function postgresAndValkeyReadinessCheck(
  database: Pick<Database, "ping">,
  queue: Pick<PingableJobQueue, "ping">,
): ReadinessCheck {
  return async () => {
    try {
      await checkDatabaseConnection(database);
      await queue.ping();
      return true;
    } catch {
      return false;
    }
  };
}
