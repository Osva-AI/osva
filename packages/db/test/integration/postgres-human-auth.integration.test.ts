import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { startPostgresForTests } from "./postgres-harness.js";

describe("PostgreSQL human authentication slice", () => {
  it("applies migration 0025 auth tables", async () => {
    const postgres = await startPostgresForTests();
    const database = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });

    try {
      await migrateDatabase(database);
      const rows = await database.sql<{ table_name: string }[]>`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name in ('auth_sessions', 'auth_accounts', 'auth_verifications')
        order by table_name
      `;
      expect(rows.map((row) => row.table_name)).toEqual([
        "auth_accounts",
        "auth_sessions",
        "auth_verifications",
      ]);
    } finally {
      await database.close();
      if (postgres.usingDocker && postgres.containerName !== undefined) {
        // harness cleanup handled by test runner lifecycle in other suites
      }
    }
  }, 120_000);
});
