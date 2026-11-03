import fs from "node:fs/promises";
import path from "node:path";

import { REPO_ROOT } from "./environment.mjs";

/**
 * Verification harness tests spawn Turbo builds, shell-backed pnpm commands, and
 * repo-wide filesystem scans. Running test files in parallel on Windows has
 * caused intermittent native child-process failures (for example during the
 * canonical example Turbo build). Keep file-level execution serial.
 */
export const HARNESS_TEST_CONCURRENCY = 1;

/**
 * @returns {Promise<string[]>}
 */
export async function listHarnessTestFiles() {
  const dir = path.join(REPO_ROOT, "scripts", "verification");
  const entries = await fs.readdir(dir);
  return entries
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => path.join(dir, name))
    .sort();
}

/**
 * @param {readonly string[]} files
 * @returns {string[]}
 */
export function harnessNodeTestArgv(files) {
  return [
    "--test",
    `--test-concurrency=${String(HARNESS_TEST_CONCURRENCY)}`,
    ...files,
  ];
}
