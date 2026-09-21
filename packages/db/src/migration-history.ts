import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MigrationHistoryManifestEntry {
  readonly idx: number;
  readonly tag: string;
  readonly file: string;
  readonly sha256: string;
}

export interface MigrationHistoryManifest {
  readonly version: number;
  readonly dialect: "postgresql";
  readonly entries: readonly MigrationHistoryManifestEntry[];
}

export interface DrizzleJournalEntry {
  readonly idx: number;
  readonly tag: string;
}

export interface DrizzleJournal {
  readonly entries: readonly DrizzleJournalEntry[];
}

export interface MigrationHistoryVerificationIssue {
  readonly code:
    | "manifest_missing"
    | "manifest_parse_error"
    | "journal_missing"
    | "journal_parse_error"
    | "manifest_journal_mismatch"
    | "manifest_entry_missing"
    | "unexpected_historical_migration"
    | "historical_sql_missing"
    | "historical_sql_hash_mismatch"
    | "historical_sql_deleted"
    | "migration_inserted"
    | "duplicate_migration_identity"
    | "journal_order_inconsistent";
  readonly migration?: string;
  readonly detail: string;
}

export interface MigrationHistoryVerificationResult {
  readonly ok: boolean;
  readonly issues: readonly MigrationHistoryVerificationIssue[];
  readonly repositoryHead: string | undefined;
}

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function drizzleDirectory(): string {
  return path.join(PACKAGE_ROOT, "drizzle");
}

export function migrationHistoryManifestPath(): string {
  return path.join(PACKAGE_ROOT, "migration-history.manifest.json");
}

export function readDrizzleJournal(
  drizzleDir: string = drizzleDirectory(),
): DrizzleJournal {
  const journalPath = path.join(drizzleDir, "meta", "_journal.json");
  const raw = fs.readFileSync(journalPath, "utf8");
  const parsed = JSON.parse(raw) as DrizzleJournal;
  return parsed;
}

export function loadMigrationHistoryManifest(
  manifestPath: string = migrationHistoryManifestPath(),
): MigrationHistoryManifest {
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw) as MigrationHistoryManifest;
}

export function canonicalizeMigrationSqlForHash(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function hashMigrationSql(content: string): string {
  return createHash("sha256")
    .update(canonicalizeMigrationSqlForHash(content), "utf8")
    .digest("hex");
}

export function computeManifestEntriesFromDisk(
  drizzleDir: string = drizzleDirectory(),
): MigrationHistoryManifestEntry[] {
  const journal = readDrizzleJournal(drizzleDir);
  return journal.entries.map((entry) => {
    const file = `${entry.tag}.sql`;
    const sqlPath = path.join(drizzleDir, file);
    const sql = fs.readFileSync(sqlPath, "utf8");
    return {
      idx: entry.idx,
      tag: entry.tag,
      file,
      sha256: hashMigrationSql(sql),
    };
  });
}

export function buildMigrationHistoryManifest(
  drizzleDir: string = drizzleDirectory(),
): MigrationHistoryManifest {
  return {
    version: 1,
    dialect: "postgresql",
    entries: computeManifestEntriesFromDisk(drizzleDir),
  };
}

export function verifyMigrationHistory(
  options: {
    readonly manifestPath?: string;
    readonly drizzleDir?: string;
  } = {},
): MigrationHistoryVerificationResult {
  const drizzleDir = options.drizzleDir ?? drizzleDirectory();
  const manifestPath = options.manifestPath ?? migrationHistoryManifestPath();
  const issues: MigrationHistoryVerificationIssue[] = [];

  if (!fs.existsSync(manifestPath)) {
    return {
      ok: false,
      issues: [
        {
          code: "manifest_missing",
          detail: `Migration history manifest is missing at ${manifestPath}.`,
        },
      ],
      repositoryHead: undefined,
    };
  }

  let manifest: MigrationHistoryManifest;
  try {
    manifest = loadMigrationHistoryManifest(manifestPath);
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "manifest_parse_error",
          detail: `Unable to parse migration history manifest at ${manifestPath}.`,
        },
      ],
      repositoryHead: undefined,
    };
  }

  let journal: DrizzleJournal;
  try {
    journal = readDrizzleJournal(drizzleDir);
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "journal_missing",
          detail:
            "Unable to read Drizzle journal at drizzle/meta/_journal.json.",
        },
      ],
      repositoryHead: manifest.entries.at(-1)?.tag,
    };
  }

  if (journal.entries.length !== manifest.entries.length) {
    issues.push({
      code: "manifest_journal_mismatch",
      detail: `Drizzle journal has ${String(journal.entries.length)} entries but manifest has ${String(manifest.entries.length)}.`,
    });
  }

  const seenTags = new Set<string>();
  const seenIdx = new Set<number>();
  for (let index = 0; index < manifest.entries.length; index += 1) {
    const entry = manifest.entries[index]!;
    if (seenTags.has(entry.tag)) {
      issues.push({
        code: "duplicate_migration_identity",
        migration: entry.tag,
        detail: `Duplicate migration tag '${entry.tag}' in manifest.`,
      });
    }
    if (seenIdx.has(entry.idx)) {
      issues.push({
        code: "duplicate_migration_identity",
        migration: entry.tag,
        detail: `Duplicate migration idx '${String(entry.idx)}' in manifest.`,
      });
    }
    seenTags.add(entry.tag);
    seenIdx.add(entry.idx);

    if (index > 0) {
      const previous = manifest.entries[index - 1]!;
      if (entry.idx !== previous.idx + 1) {
        issues.push({
          code: "journal_order_inconsistent",
          migration: entry.tag,
          detail: `Manifest idx ${String(entry.idx)} does not follow ${String(previous.idx)} sequentially.`,
        });
      }
    }

    const journalEntry = journal.entries[index];
    if (journalEntry === undefined) {
      issues.push({
        code: "manifest_entry_missing",
        migration: entry.tag,
        detail: `Manifest entry '${entry.tag}' has no matching Drizzle journal row at index ${String(index)}.`,
      });
      continue;
    }

    if (journalEntry.tag !== entry.tag || journalEntry.idx !== entry.idx) {
      issues.push({
        code: "journal_order_inconsistent",
        migration: entry.tag,
        detail: `Journal order mismatch at index ${String(index)}: journal='${journalEntry.tag}' manifest='${entry.tag}'.`,
      });
    }

    const sqlPath = path.join(drizzleDir, entry.file);
    if (!fs.existsSync(sqlPath)) {
      issues.push({
        code: "historical_sql_missing",
        migration: entry.tag,
        detail: `Locked migration SQL file '${entry.file}' is missing.`,
      });
      continue;
    }

    const actualHash = hashMigrationSql(fs.readFileSync(sqlPath, "utf8"));
    if (actualHash !== entry.sha256) {
      issues.push({
        code: "historical_sql_hash_mismatch",
        migration: entry.tag,
        detail: `Migration '${entry.tag}' SQL digest does not match manifest lock.`,
      });
    }
  }

  for (const journalEntry of journal.entries.slice(manifest.entries.length)) {
    issues.push({
      code: "unexpected_historical_migration",
      migration: journalEntry.tag,
      detail: `Migration '${journalEntry.tag}' exists in Drizzle journal but is not locked in manifest (append via db:migrations:lock).`,
    });
  }

  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();

  const lockedFiles = new Set(manifest.entries.map((entry) => entry.file));
  for (const file of sqlFiles) {
    if (!lockedFiles.has(file)) {
      issues.push({
        code: "unexpected_historical_migration",
        migration: file.replace(/\.sql$/, ""),
        detail: `Unexpected migration SQL '${file}' is not present in manifest.`,
      });
    }
  }

  for (const locked of lockedFiles) {
    if (!fs.existsSync(path.join(drizzleDir, locked))) {
      issues.push({
        code: "historical_sql_deleted",
        migration: locked.replace(/\.sql$/, ""),
        detail: `Locked migration SQL '${locked}' was deleted from drizzle/.`,
      });
    }
  }

  for (let index = 1; index < manifest.entries.length; index += 1) {
    const current = manifest.entries[index]!;
    const previous = manifest.entries[index - 1]!;
    if (current.idx <= previous.idx) {
      issues.push({
        code: "migration_inserted",
        migration: current.tag,
        detail: `Migration '${current.tag}' appears inserted before head '${previous.tag}'.`,
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    repositoryHead: manifest.entries.at(-1)?.tag,
  };
}

export interface MigrationHistoryLockResult {
  readonly ok: boolean;
  readonly message: string;
  readonly appended?: readonly MigrationHistoryManifestEntry[];
}

export function lockMigrationHistory(
  options: {
    readonly manifestPath?: string;
    readonly drizzleDir?: string;
  } = {},
): MigrationHistoryLockResult {
  const drizzleDir = options.drizzleDir ?? drizzleDirectory();
  const manifestPath = options.manifestPath ?? migrationHistoryManifestPath();
  const diskEntries = computeManifestEntriesFromDisk(drizzleDir);

  if (!fs.existsSync(manifestPath)) {
    const manifest = buildMigrationHistoryManifest(drizzleDir);
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    return {
      ok: true,
      message: `Created migration history manifest with ${String(manifest.entries.length)} entries.`,
      appended: manifest.entries,
    };
  }

  const existing = loadMigrationHistoryManifest(manifestPath);
  for (const locked of existing.entries) {
    const disk = diskEntries.find((entry) => entry.tag === locked.tag);
    if (disk === undefined) {
      return {
        ok: false,
        message: `Refusing to update manifest: locked migration '${locked.tag}' was removed from drizzle/.`,
      };
    }
    if (disk.sha256 !== locked.sha256) {
      return {
        ok: false,
        message: `Refusing to update manifest: locked migration '${locked.tag}' SQL was modified.`,
      };
    }
  }

  if (diskEntries.length < existing.entries.length) {
    return {
      ok: false,
      message:
        "Refusing to update manifest: Drizzle journal has fewer entries than locked history.",
    };
  }

  if (diskEntries.length === existing.entries.length) {
    return {
      ok: true,
      message: "Migration history manifest is already up to date.",
    };
  }

  for (let index = 0; index < existing.entries.length; index += 1) {
    const locked = existing.entries[index]!;
    const disk = diskEntries[index]!;
    if (locked.tag !== disk.tag || locked.idx !== disk.idx) {
      return {
        ok: false,
        message: `Refusing to update manifest: migration order changed at index ${String(index)}.`,
      };
    }
  }

  const appended = diskEntries.slice(existing.entries.length);
  const nextManifest: MigrationHistoryManifest = {
    version: 1,
    dialect: "postgresql",
    entries: [...existing.entries, ...appended],
  };
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(nextManifest, null, 2)}\n`,
    "utf8",
  );

  return {
    ok: true,
    message: `Appended ${String(appended.length)} migration(s) to history manifest.`,
    appended,
  };
}
