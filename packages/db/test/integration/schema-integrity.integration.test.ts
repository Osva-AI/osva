import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { createDatabase } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { readMigrationStatus } from "../../src/migration-status.js";
import { readDrizzleJournal } from "../../src/migration-history.js";
import {
  BETTER_AUTH_USER_IMAGE_MIGRATION_TAG,
  formatSchemaIntegrity,
  verifySchemaIntegrity,
} from "../../src/schema-integrity.js";

import {
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const ROLLBACK = new Error("osva-integrity-rollback");

describe("schema integrity against disposable PostgreSQL", () => {
  let postgresContext: PostgresTestContext;

  beforeAll(async () => {
    postgresContext = await startPostgresForTests();
    const database = createDatabase({
      connectionString: postgresContext.connectionString,
      max: 1,
    });
    try {
      await migrateDatabase(database);
    } finally {
      await database.close();
    }
  }, 180_000);

  afterAll(async () => {
    await stopPostgresForTests(postgresContext);
  });

  it("reports applied_and_matches after a healthy migrate", async () => {
    const database = createDatabase({
      connectionString: postgresContext.connectionString,
      max: 1,
    });
    try {
      const status = await readMigrationStatus(database.sql);
      const report = await verifySchemaIntegrity(database.sql);
      expect(status.status).toBe("current");
      expect(report.outcome).toBe("applied_and_matches");
      expect(report.checks.every((check) => check.ok)).toBe(true);
      expect(formatSchemaIntegrity(report)).not.toContain("postgres://");
    } finally {
      await database.close();
    }
  });

  it("does not mutate schema or journal when the diagnostic runs", async () => {
    const database = createDatabase({
      connectionString: postgresContext.connectionString,
      max: 1,
    });
    try {
      const before = await schemaFingerprint(database.sql);
      await verifySchemaIntegrity(database.sql);
      const after = await schemaFingerprint(database.sql);
      expect(after).toEqual(before);
    } finally {
      await database.close();
    }
  });

  it("detects the Batch 2 missing 0023 columns while the journal claims applied", async () => {
    await withRolledBackMutation(
      postgresContext.connectionString,
      async (sql) => {
        await sql.unsafe(`
        ALTER TABLE run_attempts
          DROP COLUMN IF EXISTS execution_owner,
          DROP COLUMN IF EXISTS execution_generation,
          DROP COLUMN IF EXISTS lease_expires_at
      `);
        const report = await verifySchemaIntegrity(sql);
        expect(report.outcome).toBe("schema_mismatch");
        expect(report.journal.journalStatus).toBe("current");
        expect(
          report.checks.some(
            (check) => check.name === "execution_owner" && !check.ok,
          ),
        ).toBe(true);
        const formatted = formatSchemaIntegrity(report);
        expect(formatted).toContain(
          "Do not rerun the migration file automatically",
        );
        expect(formatted).not.toContain("postgres://");
        expect(formatted).not.toContain("osva:osva");
      },
    );
  });

  it("detects a missing recovery index", async () => {
    await withRolledBackMutation(
      postgresContext.connectionString,
      async (sql) => {
        await sql.unsafe(`DROP INDEX IF EXISTS run_attempts_expired_lease_idx`);
        const report = await verifySchemaIntegrity(sql);
        expect(report.outcome).toBe("schema_mismatch");
        expect(
          report.checks.some(
            (check) =>
              check.name === "run_attempts_expired_lease_idx" && !check.ok,
          ),
        ).toBe(true);
      },
    );
  });

  it("detects incorrect column definitions", async () => {
    await withRolledBackMutation(
      postgresContext.connectionString,
      async (sql) => {
        await sql.unsafe(
          `ALTER TABLE run_attempts ALTER COLUMN execution_generation DROP NOT NULL`,
        );
        const report = await verifySchemaIntegrity(sql);
        expect(report.outcome).toBe("schema_mismatch");
        expect(
          report.checks.some(
            (check) => check.name === "execution_generation" && !check.ok,
          ),
        ).toBe(true);
      },
    );
  });

  it("detects journal ahead of the physical schema", async () => {
    await withRolledBackMutation(
      postgresContext.connectionString,
      async (sql) => {
        await sql.unsafe(`DROP INDEX IF EXISTS run_attempts_expired_lease_idx`);
        await sql.unsafe(`
        ALTER TABLE run_attempts
          DROP COLUMN IF EXISTS lease_expires_at
      `);
        const report = await verifySchemaIntegrity(sql);
        expect(report.journal.appliedCount).toBeGreaterThan(0);
        expect(report.outcome).toBe("schema_mismatch");
      },
    );
  });

  it("detects schema ahead of the journal", async () => {
    await withRolledBackMutation(
      postgresContext.connectionString,
      async (sql) => {
        const journal = readDrizzleJournal();
        const probedMigrationIndex = journal.entries.findIndex(
          (entry) => entry.tag === BETTER_AUTH_USER_IMAGE_MIGRATION_TAG,
        );
        expect(probedMigrationIndex).toBeGreaterThanOrEqual(0);
        const deleteNewestCount = journal.entries.length - probedMigrationIndex;
        // Drop newest journal rows so pending includes the probed migration while
        // the physical schema still has its artifacts (and later migration objects).
        await sql.unsafe(`
        DELETE FROM drizzle.__drizzle_migrations
        WHERE hash IN (
          SELECT hash FROM drizzle.__drizzle_migrations
          ORDER BY id DESC
          LIMIT ${deleteNewestCount}
        )
      `);
        const report = await verifySchemaIntegrity(sql);
        expect(report.outcome).toBe("schema_ahead");
        expect(report.journal.pendingMigrations).toContain(
          BETTER_AUTH_USER_IMAGE_MIGRATION_TAG,
        );
      },
    );
  });

  it("classifies an empty database as not_migrated", async () => {
    await withIsolatedDatabase(
      postgresContext.connectionString,
      async (url) => {
        const database = createDatabase({ connectionString: url, max: 1 });
        try {
          const report = await verifySchemaIntegrity(database.sql);
          expect(report.outcome).toBe("not_migrated");
        } finally {
          await database.close();
        }
      },
    );
  });

  it("classifies an unreachable database as database_inaccessible", async () => {
    const database = createDatabase({
      connectionString: "postgres://osva:osva@127.0.0.1:1/osva",
      max: 1,
      connectTimeoutSeconds: 1,
    });
    try {
      const report = await verifySchemaIntegrity(database.sql);
      expect(report.outcome).toBe("database_inaccessible");
      expect(formatSchemaIntegrity(report)).not.toContain("postgres://");
    } finally {
      await database.close();
    }
  });
});

async function schemaFingerprint(sql: postgres.Sql): Promise<unknown> {
  const columns = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'run_attempts'
    ORDER BY column_name
  `;
  const indexes = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'run_attempts'
    ORDER BY indexname
  `;
  const journal = await sql`
    SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
  `;
  return { columns, indexes, journal };
}

async function withRolledBackMutation(
  connectionString: string,
  body: (sql: postgres.Sql) => Promise<void>,
): Promise<void> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await body(tx as unknown as postgres.Sql);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) {
      throw error;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function withIsolatedDatabase(
  adminUrl: string,
  body: (url: string) => Promise<void>,
): Promise<void> {
  const name = `osva_integrity_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(adminUrl, { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const isolated = replaceDatabaseName(adminUrl, name);
    await body(isolated);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("permission denied") || message.includes("createdb")) {
      return;
    }
    throw error;
  } finally {
    await admin
      .unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      .catch(() => undefined);
    await admin.end({ timeout: 5 }).catch(() => undefined);
  }
}

function replaceDatabaseName(connectionString: string, name: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}
