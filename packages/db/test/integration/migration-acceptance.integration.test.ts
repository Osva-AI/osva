import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDatabase,
  migrateDatabase,
  readMigrationStatus,
  tryAcquireMigrationAdvisoryLock,
  acquireMigrationAdvisoryLock,
  releaseMigrationAdvisoryLock,
  drizzleDirectory,
} from "../../src/index.js";
import { readDrizzleJournal } from "../../src/migration-history.js";
import { PostgresAgentRepository } from "../../src/index.js";
import { Agent } from "@osva/domain";
import type { AgentId, WorkspaceId } from "@osva-ai/contracts";

import {
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

function materializeMigrationsThroughIndex(
  targetDir: string,
  maxIdx: number,
): void {
  const sourceDir = drizzleDirectory();
  const journal = readDrizzleJournal(sourceDir);
  const filtered = journal.entries.filter(
    (entry: { idx: number }) => entry.idx <= maxIdx,
  );
  fs.mkdirSync(path.join(targetDir, "meta"), { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, "meta", "_journal.json"),
    `${JSON.stringify({ ...journal, entries: filtered }, null, 2)}\n`,
    "utf8",
  );
  for (const entry of filtered) {
    fs.copyFileSync(
      path.join(sourceDir, `${entry.tag}.sql`),
      path.join(targetDir, `${entry.tag}.sql`),
    );
  }
}

describe("PostgreSQL migration acceptance", () => {
  let postgres: PostgresTestContext;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
  }, 180_000);

  afterAll(async () => {
    await stopPostgresForTests(postgres);
  });

  it("migrates a fresh database through repository head", async () => {
    const database = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });

    await migrateDatabase(database);
    const status = await readMigrationStatus(database.sql);
    expect(status.status).toBe("current");
    expect(status.repositoryHead).toBe("0026_better_auth_user_image");
    expect(status.pendingMigrations).toEqual([]);

    const userImageColumn = await database.sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'image'
    `;
    expect(userImageColumn[0]?.column_name).toBe("image");

    const apiKeys = await database.sql`
      SELECT to_regclass('public.api_keys') AS api_keys_table
    `;
    expect(apiKeys[0]?.api_keys_table).toBe("api_keys");

    const identityTables = await database.sql`
      SELECT to_regclass('public.users') AS users_table,
             to_regclass('public.workspace_memberships') AS workspace_memberships_table
    `;
    expect(identityTables[0]?.users_table).toBe("users");
    expect(identityTables[0]?.workspace_memberships_table).toBe(
      "workspace_memberships",
    );

    const ownerUniqueIndexes = await database.sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'workspace_memberships'
        AND indexdef ILIKE '%unique%'
        AND indexdef ILIKE '%owner%'
    `;
    expect(ownerUniqueIndexes).toEqual([]);

    await database.close();
  });

  it("upgrades a pre-Stage-3.7 database at 0021 while preserving tenant data", async () => {
    const stage21Dir = fs.mkdtempSync(path.join(os.tmpdir(), "osva-mig-21-"));
    materializeMigrationsThroughIndex(stage21Dir, 21);

    const database = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });

    await database.sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await database.sql`DROP SCHEMA public CASCADE`;
    await database.sql`CREATE SCHEMA public`;

    await migrateDatabase(database, { migrationsFolder: stage21Dir });

    const workspaceId = "ws-upgrade-37" as WorkspaceId;
    await database.sql`
      INSERT INTO workspaces (id, name, created_at)
      VALUES (
        ${workspaceId},
        ${"Upgrade Workspace"},
        ${"2026-01-01T00:00:00.000Z"}
      )
    `;

    const agents = new PostgresAgentRepository(database);
    await agents.saveAgent(
      Agent.create({
        id: "agent-upgrade-37" as AgentId,
        workspaceId,
        key: "upgrade-agent",
        name: "Upgrade Agent",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    );

    const before =
      await database.sql`SELECT COUNT(*)::int AS count FROM agents`;
    expect(before[0]?.count).toBe(1);

    await migrateDatabase(database);

    const after = await database.sql`SELECT COUNT(*)::int AS count FROM agents`;
    expect(after[0]?.count).toBe(1);

    const status = await readMigrationStatus(database.sql);
    expect(status.status).toBe("current");
    expect(status.repositoryHead).toBe("0026_better_auth_user_image");

    const apiKeys = await database.sql`
      SELECT to_regclass('public.api_keys') AS api_keys_table
    `;
    expect(apiKeys[0]?.api_keys_table).toBe("api_keys");

    const organizationColumn = await database.sql`
      SELECT organization_id FROM workspaces WHERE id = ${workspaceId}
    `;
    expect(organizationColumn[0]?.organization_id).toBeNull();

    await database.close();
  });

  it("treats a fully migrated database as a safe no-op on re-run", async () => {
    const database = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });

    await migrateDatabase(database);
    const first = await readMigrationStatus(database.sql);
    await migrateDatabase(database);
    const second = await readMigrationStatus(database.sql);

    expect(first.status).toBe("current");
    expect(second.status).toBe("current");
    expect(second.databaseAppliedCount).toBe(first.databaseAppliedCount);

    await database.close();
  });

  it("uses a PostgreSQL advisory lock to prevent concurrent migration sessions", async () => {
    const holder = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });
    const contender = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });

    await acquireMigrationAdvisoryLock(holder.sql);
    expect(await tryAcquireMigrationAdvisoryLock(contender.sql)).toBe(false);

    await releaseMigrationAdvisoryLock(holder.sql);
    expect(await tryAcquireMigrationAdvisoryLock(contender.sql)).toBe(true);
    await releaseMigrationAdvisoryLock(contender.sql);

    await holder.close();
    await contender.close();
  });

  it("upgrades a database at migration 0025 to 0026 without data loss", async () => {
    const stage25Dir = fs.mkdtempSync(path.join(os.tmpdir(), "osva-mig-25-"));
    materializeMigrationsThroughIndex(stage25Dir, 25);

    const database = createDatabase({
      connectionString: postgres.connectionString,
      max: 1,
    });

    await database.sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await database.sql`DROP SCHEMA public CASCADE`;
    await database.sql`CREATE SCHEMA public`;

    await migrateDatabase(database, { migrationsFolder: stage25Dir });

    const ownerEmail = "upgrade-25@example.com";
    await database.sql`
      INSERT INTO users (id, email, display_name, status, email_verified, created_at, updated_at)
      VALUES (
        'user-upgrade-25',
        ${ownerEmail},
        'Upgrade User',
        'ACTIVE',
        false,
        ${"2026-01-01T00:00:00.000Z"},
        ${"2026-01-01T00:00:00.000Z"}
      )
    `;

    const beforeImage = await database.sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'image'
    `;
    expect(beforeImage).toEqual([]);

    await migrateDatabase(database);

    const afterImage = await database.sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'image'
    `;
    expect(afterImage[0]?.column_name).toBe("image");

    const userRow = await database.sql`
      SELECT email FROM users WHERE id = 'user-upgrade-25'
    `;
    expect(userRow[0]?.email).toBe(ownerEmail);

    const status = await readMigrationStatus(database.sql);
    expect(status.repositoryHead).toBe("0026_better_auth_user_image");

    await database.close();
  });
});
