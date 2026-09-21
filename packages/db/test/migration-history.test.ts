import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalizeMigrationSqlForHash,
  drizzleDirectory,
  hashMigrationSql,
  lockMigrationHistory,
  readDrizzleJournal,
  verifyMigrationHistory,
} from "../src/migration-history.js";

describe("migration history verification", () => {
  it("accepts the committed manifest and drizzle journal", () => {
    const result = verifyMigrationHistory();
    expect(result.ok, JSON.stringify(result.issues, null, 2)).toBe(true);
    expect(result.repositoryHead).toBe("0022_api_security_slice");
  });

  it("detects modified historical SQL in fixture copies", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "osva-mig-verify-"));
    const tempDrizzle = path.join(tempRoot, "drizzle");
    fs.cpSync(drizzleDirectory(), tempDrizzle, { recursive: true });
    const manifestPath = path.join(tempRoot, "manifest.json");
    fs.copyFileSync(
      path.join(
        path.dirname(drizzleDirectory()),
        "migration-history.manifest.json",
      ),
      manifestPath,
    );

    const first = readDrizzleJournal(tempDrizzle).entries[0]!;
    const sqlPath = path.join(tempDrizzle, `${first.tag}.sql`);
    fs.appendFileSync(sqlPath, "\n-- corruption\n", "utf8");

    const result = verifyMigrationHistory({
      drizzleDir: tempDrizzle,
      manifestPath,
    });
    expect(result.ok).toBe(false);
    expect(
      result.issues.some(
        (issue) => issue.code === "historical_sql_hash_mismatch",
      ),
    ).toBe(true);
  });

  it("refuses to bless historical edits through lock", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "osva-mig-lock-"));
    const tempDrizzle = path.join(tempRoot, "drizzle");
    fs.cpSync(drizzleDirectory(), tempDrizzle, { recursive: true });
    const manifestPath = path.join(tempRoot, "manifest.json");
    fs.copyFileSync(
      path.join(
        path.dirname(drizzleDirectory()),
        "migration-history.manifest.json",
      ),
      manifestPath,
    );

    const head = readDrizzleJournal(tempDrizzle).entries.at(-1)!;
    fs.appendFileSync(
      path.join(tempDrizzle, `${head.tag}.sql`),
      "\n-- corruption\n",
      "utf8",
    );

    const result = lockMigrationHistory({
      drizzleDir: tempDrizzle,
      manifestPath,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("modified");
  });

  it("computes stable sha256 digests", () => {
    const journal = readDrizzleJournal();
    const entry = journal.entries[0]!;
    const sql = fs.readFileSync(
      path.join(drizzleDirectory(), `${entry.tag}.sql`),
      "utf8",
    );
    expect(hashMigrationSql(sql)).toHaveLength(64);
  });

  it("hashes LF, CRLF, and CR newline styles identically", () => {
    const lines = ["CREATE TABLE example (...);", "ALTER TABLE ..."];
    const lf = `${lines.join("\n")}\n`;
    const crlf = `${lines.join("\r\n")}\r\n`;
    const cr = `${lines.join("\r")}\r`;

    expect(hashMigrationSql(lf)).toBe(hashMigrationSql(crlf));
    expect(hashMigrationSql(lf)).toBe(hashMigrationSql(cr));
    expect(canonicalizeMigrationSqlForHash(crlf)).toBe(lf);
  });

  it("still changes digest when SQL content changes", () => {
    const foo = "CREATE TABLE foo (id text PRIMARY KEY);\n";
    const bar = "CREATE TABLE bar (id text PRIMARY KEY);\n";
    expect(hashMigrationSql(foo)).not.toBe(hashMigrationSql(bar));
  });
});
