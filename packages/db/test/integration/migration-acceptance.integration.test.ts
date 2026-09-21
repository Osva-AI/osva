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
import {
  PostgresAgentRepository,
  PostgresWorkspaceRepository,
} from "../../src/index.js";
import { Agent, Workspace } from "@osva/domain";
import type { AgentId, WorkspaceId } from "@osva/contracts";

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
    expect(status.repositoryHead).toBe("0022_api_security_slice");
    expect(status.pendingMigrations).toEqual([]);

    const apiKeys = await database.sql`
      SELECT to_regclass('public.api_keys') AS api_keys_table
    `;
    expect(apiKeys[0]?.api_keys_table).toBe("api_keys");

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

    const workspaces = new PostgresWorkspaceRepository(database);
    const workspaceId = "ws-upgrade-37" as WorkspaceId;
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Upgrade Workspace",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    );

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
    expect(status.repositoryHead).toBe("0022_api_security_slice");

    const apiKeys = await database.sql`
      SELECT to_regclass('public.api_keys') AS api_keys_table
    `;
    expect(apiKeys[0]?.api_keys_table).toBe("api_keys");

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
});
