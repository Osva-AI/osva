import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkDatabaseConnection } from "../../src/check-database-connection.js";
import { createDatabase, type Database } from "../../src/database.js";
import {
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL connectivity helper", () => {
  let context: PostgresTestContext;
  let database: Database;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 2,
      connectTimeoutSeconds: 10,
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  it("succeeds when PostgreSQL is available", async () => {
    await expect(checkDatabaseConnection(database)).resolves.toBeUndefined();
    await expect(database.ping()).resolves.toBeUndefined();
  });

  it("fails safely when the client is closed", async () => {
    await database.close();

    await expect(checkDatabaseConnection(database)).rejects.toThrow(
      "PostgreSQL is unavailable.",
    );

    try {
      await checkDatabaseConnection(database);
    } catch (error) {
      expect(String(error)).not.toContain("postgres://");
      expect(String(error)).not.toContain(context.connectionString);
    }
  });
});
