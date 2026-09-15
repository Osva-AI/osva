import { checkDatabaseConnection, type Database } from "@osva/db";

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
