import fs from "node:fs/promises";
import path from "node:path";

import { REPO_ROOT, runCommand } from "./environment.mjs";

const PRETTIER_EXTENSIONS = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".cts",
  ".mts",
  ".jsx",
  ".tsx",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
  ".md",
  ".mdx",
]);

export async function gitLines(args) {
  const result = await runCommand("git", args, { stdio: "pipe" });
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${String(result.code)}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function changedFiles() {
  const [unstaged, staged, untracked] = await Promise.all([
    gitLines(["diff", "--name-only", "--diff-filter=ACMR"]),
    gitLines(["diff", "--name-only", "--cached", "--diff-filter=ACMR"]),
    gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const unique = [...new Set([...unstaged, ...staged, ...untracked])].sort();
  const existing = [];
  for (const relative of unique) {
    const absolute = path.join(REPO_ROOT, relative);
    try {
      const stat = await fs.stat(absolute);
      if (stat.isFile()) {
        existing.push(relative.split(path.sep).join("/"));
      }
    } catch {
      // deleted between listing and stat
    }
  }
  return existing;
}

export function isPrettierPath(relativePath) {
  const ext = path.posix.extname(relativePath).toLowerCase();
  if (!PRETTIER_EXTENSIONS.has(ext)) {
    const base = path.posix.basename(relativePath);
    return base === ".prettierrc" || base === ".prettierrc.json";
  }
  if (relativePath === "pnpm-lock.yaml") {
    return false;
  }
  if (relativePath === "LICENSE") {
    return false;
  }
  if (relativePath.endsWith(".md") || relativePath.startsWith("docs/")) {
    return false;
  }
  if (
    relativePath.startsWith("dist/") ||
    relativePath.includes("/dist/") ||
    relativePath.startsWith("coverage/") ||
    relativePath.includes("/coverage/") ||
    relativePath.startsWith(".turbo/") ||
    relativePath.includes("/node_modules/")
  ) {
    return false;
  }
  return true;
}

export async function prettierSupportedChangedFiles() {
  const files = await changedFiles();
  return files.filter(isPrettierPath);
}

export async function loadWorkspacePackages() {
  const groups = ["apps", "packages", "adapters", "examples"];
  const packages = [];
  for (const group of groups) {
    const groupDir = path.join(REPO_ROOT, group);
    let entries = [];
    try {
      entries = await fs.readdir(groupDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifestPath = path.join(groupDir, entry.name, "package.json");
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        packages.push({
          name: manifest.name,
          dir: `${group}/${entry.name}`,
        });
      } catch {
        // not a package
      }
    }
  }
  return packages;
}

const GLOBAL_QUICK_FILES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "turbo.json",
  "tsconfig.json",
  "tsconfig.base.json",
  "eslint.config.js",
  "vitest.config.ts",
  ".prettierrc.json",
  ".prettierignore",
]);

export function affectedPackages(files, packages) {
  const names = new Set();
  let global = false;
  for (const file of files) {
    if (GLOBAL_QUICK_FILES.has(file)) {
      global = true;
      continue;
    }
    const match = packages.find(
      (pkg) => file === pkg.dir || file.startsWith(`${pkg.dir}/`),
    );
    if (match) {
      names.add(match.name);
    }
  }
  return { global, names: [...names].sort() };
}

export async function hasPrettierCrlfBaseline() {
  if (process.platform !== "win32") {
    return false;
  }
  if (process.env.GITHUB_ACTIONS === "true") {
    return false;
  }
  const result = await runCommand("git", ["ls-files", "--eol"], {
    stdio: "pipe",
  });
  if (result.code !== 0) {
    return false;
  }
  for (const line of result.stdout.split(/\r?\n/)) {
    const tab = line.lastIndexOf("\t");
    if (tab < 0) {
      continue;
    }
    const meta = line.slice(0, tab);
    const relative = line.slice(tab + 1).trim();
    if (!/\bw\/crlf\b/.test(meta)) {
      continue;
    }
    if (isPrettierPath(relative.split(path.sep).join("/"))) {
      return true;
    }
  }
  return false;
}
