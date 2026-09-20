import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import {
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL integration harness (pgvector)", () => {
  let context: PostgresTestContext;
  let database: Database;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 2,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  it("uses Docker pgvector when OSVA_TEST_DATABASE_URL is unset", () => {
    if (process.env.OSVA_TEST_DATABASE_URL?.trim()) {
      return;
    }
    expect(context.usingDocker).toBe(true);
  });

  it("has vector extension after the full migration chain", async () => {
    const rows = await database.sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    expect(rows[0]?.extname).toBe("vector");
    await database.sql`SELECT '[1,2,3]'::vector AS probe`;
  });
});
