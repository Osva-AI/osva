import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import type { Database } from "./database.js";
import {
  acquireMigrationAdvisoryLock,
  releaseMigrationAdvisoryLock,
} from "./migration-advisory-lock.js";

export function migrationsFolder(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../drizzle",
  );
}

export interface MigrateDatabaseOptions {
  readonly migrationsFolder?: string;
}

export async function migrateDatabase(
  database: Database,
  options: MigrateDatabaseOptions = {},
): Promise<void> {
  const folder = options.migrationsFolder ?? migrationsFolder();
  await acquireMigrationAdvisoryLock(database.sql);
  try {
    await migrate(database.db, { migrationsFolder: folder });
  } finally {
    await releaseMigrationAdvisoryLock(database.sql);
  }
}
