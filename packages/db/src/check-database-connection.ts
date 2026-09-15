import type { Database } from "./database.js";

const DATABASE_UNAVAILABLE = "PostgreSQL is unavailable.";

/**
 * Verifies that a Database client can reach PostgreSQL.
 * Driver and connection details are not included in the thrown error.
 */
export async function checkDatabaseConnection(
  database: Pick<Database, "ping">,
): Promise<void> {
  try {
    await database.ping();
  } catch {
    throw new Error(DATABASE_UNAVAILABLE);
  }
}
