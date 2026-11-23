import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const DRIZZLE_JOURNAL_PATH = path.join(
  REPO_ROOT,
  "packages",
  "db",
  "drizzle",
  "meta",
  "_journal.json",
);

/** Repository migration head from the committed Drizzle journal. */
export function readRepositoryMigrationHead() {
  const journal = JSON.parse(fs.readFileSync(DRIZZLE_JOURNAL_PATH, "utf8"));
  const tag = journal.entries?.at(-1)?.tag;
  if (typeof tag !== "string" || tag.length === 0) {
    throw new Error(`Missing migration head in ${DRIZZLE_JOURNAL_PATH}`);
  }
  return tag;
}
