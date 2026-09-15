import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import type { Database } from "./database.js";

export function migrationsFolder(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../drizzle",
  );
}

export async function migrateDatabase(database: Database): Promise<void> {
  await migrate(database.db, { migrationsFolder: migrationsFolder() });
}
