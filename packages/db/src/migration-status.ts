import type { Sql } from "postgres";

import {
  readDrizzleJournal,
  type MigrationHistoryManifestEntry,
} from "./migration-history.js";

export type MigrationRepositoryStatus =
  "current" | "behind" | "unexpected" | "empty";

export interface MigrationStatusSnapshot {
  readonly repositoryHead: string | undefined;
  readonly repositoryAppliedCount: number;
  readonly databaseHead: string | undefined;
  readonly databaseAppliedCount: number;
  readonly pendingMigrations: readonly string[];
  readonly status: MigrationRepositoryStatus;
}

export interface DrizzleAppliedMigrationRow {
  readonly id: number;
  readonly hash: string;
  readonly created_at: Date | string | number;
}

export async function readAppliedDrizzleMigrations(
  sql: Sql,
): Promise<readonly DrizzleAppliedMigrationRow[]> {
  const rows = await sql<DrizzleAppliedMigrationRow[]>`
    SELECT id, hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY id ASC
  `;
  return rows;
}

export function repositoryMigrationEntries(): readonly MigrationHistoryManifestEntry[] {
  const journal = readDrizzleJournal();
  return journal.entries.map((entry) => ({
    idx: entry.idx,
    tag: entry.tag,
    file: `${entry.tag}.sql`,
    sha256: "",
  }));
}

export function compareMigrationStatus(input: {
  readonly repositoryTags: readonly string[];
  readonly appliedCount: number;
}): MigrationStatusSnapshot {
  const repositoryHead = input.repositoryTags.at(-1);
  const pending = input.repositoryTags.slice(input.appliedCount);
  let status: MigrationRepositoryStatus = "current";

  if (input.appliedCount === 0 && input.repositoryTags.length > 0) {
    status = "behind";
  } else if (input.appliedCount > input.repositoryTags.length) {
    status = "unexpected";
  } else if (pending.length > 0) {
    status = "behind";
  }

  const databaseHead =
    input.appliedCount === 0
      ? undefined
      : input.repositoryTags[input.appliedCount - 1];

  return {
    repositoryHead,
    repositoryAppliedCount: input.repositoryTags.length,
    databaseHead,
    databaseAppliedCount: input.appliedCount,
    pendingMigrations: pending,
    status,
  };
}

export async function readMigrationStatus(
  sql: Sql,
): Promise<MigrationStatusSnapshot> {
  const journal = readDrizzleJournal();
  const repositoryTags = journal.entries.map((entry) => entry.tag);

  let appliedCount = 0;
  try {
    const applied = await readAppliedDrizzleMigrations(sql);
    appliedCount = applied.length;
  } catch (error) {
    if (isMissingMigrationsTableError(error)) {
      appliedCount = 0;
    } else {
      throw error;
    }
  }

  return compareMigrationStatus({ repositoryTags, appliedCount });
}

function isMissingMigrationsTableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("drizzle.__drizzle_migrations") &&
    (message.includes("does not exist") || message.includes("undefined_table"))
  );
}

export function formatMigrationStatus(
  snapshot: MigrationStatusSnapshot,
): string {
  return [
    `repository head: ${snapshot.repositoryHead ?? "(none)"}`,
    `database head: ${snapshot.databaseHead ?? "(none)"}`,
    `repository migrations: ${String(snapshot.repositoryAppliedCount)}`,
    `database applied count: ${String(snapshot.databaseAppliedCount)}`,
    `pending migrations: ${
      snapshot.pendingMigrations.length === 0
        ? "(none)"
        : snapshot.pendingMigrations.join(", ")
    }`,
    `status: ${snapshot.status}`,
  ].join("\n");
}

export function redactDatabaseTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password.length > 0) {
      url.password = "***";
    }
    if (url.username.length > 0) {
      url.username = "***";
    }
    return url.toString();
  } catch {
    return "(invalid connection string)";
  }
}
