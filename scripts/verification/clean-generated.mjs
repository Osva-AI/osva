import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT } from "./environment.mjs";

const GENERATED_DIRECTORIES = new Set([
  "dist",
  "dist-test",
  "build",
  "coverage",
  "out",
  ".turbo",
  ".cache",
  ".next",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
]);

const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".venv",
  ".pnpm-store",
]);

function isGeneratedFileName(name) {
  return name.endsWith(".tsbuildinfo") || name.endsWith(".egg-info");
}

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * @param {string} root
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<string[]>}
 */
export async function cleanGenerated(root = REPO_ROOT, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const resolvedRoot = path.resolve(root);
  const removed = [];

  async function visit(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (!isInsideRoot(resolvedRoot, fullPath)) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) {
          continue;
        }
        if (
          GENERATED_DIRECTORIES.has(entry.name) ||
          entry.name.endsWith(".egg-info")
        ) {
          removed.push(path.relative(resolvedRoot, fullPath));
          if (!dryRun) {
            await fs.rm(fullPath, { recursive: true, force: true });
          }
          continue;
        }
        await visit(fullPath);
        continue;
      }
      if (entry.isFile() && isGeneratedFileName(entry.name)) {
        removed.push(path.relative(resolvedRoot, fullPath));
        if (!dryRun) {
          await fs.rm(fullPath, { force: true });
        }
      }
    }
  }

  await visit(resolvedRoot);
  removed.sort();
  return removed;
}

export async function leftoverBuildOutputs(root = REPO_ROOT) {
  const resolvedRoot = path.resolve(root);
  const leftovers = [];

  async function visit(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (!isInsideRoot(resolvedRoot, fullPath)) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) {
          continue;
        }
        if (entry.name === "dist" || entry.name === ".turbo") {
          leftovers.push(path.relative(resolvedRoot, fullPath));
          continue;
        }
        await visit(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".tsbuildinfo")) {
        leftovers.push(path.relative(resolvedRoot, fullPath));
      }
    }
  }

  await visit(resolvedRoot);
  leftovers.sort();
  return leftovers;
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return (
    path.normalize(fileURLToPath(import.meta.url)).toLowerCase() ===
    path.normalize(path.resolve(entry)).toLowerCase()
  );
}

if (isMainModule()) {
  const dryRun = process.argv.includes("--dry-run");
  const rootIndex = process.argv.indexOf("--root");
  const root =
    rootIndex >= 0 && process.argv[rootIndex + 1]
      ? process.argv[rootIndex + 1]
      : REPO_ROOT;
  const removed = await cleanGenerated(root, { dryRun });
  const prefix = dryRun ? "would remove" : "removed";
  if (removed.length === 0) {
    console.log(`${prefix}: (none)`);
  } else {
    for (const item of removed) {
      console.log(`${prefix}: ${item}`);
    }
  }
}
