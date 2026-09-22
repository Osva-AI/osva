#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".turbo",
  "dist",
  ".pnpm-store",
]);

const PATTERNS = [
  { name: "aws-access-key", regex: /AKIA[0-9A-Z]{16}/ },
  {
    name: "private-key-block",
    regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: "github-pat",
    regex: /ghp_[0-9A-Za-z]{20,}/,
  },
  {
    name: "osva-api-key-token",
    regex: /osva_ak_[0-9A-Za-z_-]+\.[0-9A-Za-z_-]{20,}/,
  },
];

const ALLOWLIST_SUBSTRINGS = [
  "osva_ak_test.placeholder",
  "osva_ak_[0-9A-Za-z_-]+",
  "override-me@postgresql.invalid",
  "example@postgres.example.invalid",
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function isAllowlisted(line) {
  return ALLOWLIST_SUBSTRINGS.some((snippet) => line.includes(snippet));
}

function scanFile(filePath) {
  const rel = path.relative(REPO_ROOT, filePath);
  if (rel.startsWith("pnpm-lock.yaml")) {
    return [];
  }
  if (filePath.endsWith(".png") || filePath.endsWith(".jpg")) {
    return [];
  }
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  if (text.includes("\u0000")) {
    return [];
  }
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isAllowlisted(line)) {
      continue;
    }
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(line)) {
        hits.push({
          file: rel,
          line: i + 1,
          pattern: pattern.name,
          sample: line.trim(),
        });
      }
    }
  }
  return hits;
}

function main() {
  const roots = [REPO_ROOT];
  const allHits = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (file.includes(`${path.sep}.git${path.sep}`)) {
        continue;
      }
      if (file.endsWith(".env") && !file.endsWith(".env.example")) {
        allHits.push({
          file: path.relative(REPO_ROOT, file),
          line: 0,
          pattern: "dotenv-file",
          sample: ".env present",
        });
        continue;
      }
      allHits.push(...scanFile(file));
    }
  }

  const trackedEnv = spawnSync("git", ["ls-files", "*.env"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (trackedEnv.stdout.trim()) {
    for (const file of trackedEnv.stdout.trim().split(/\r?\n/)) {
      allHits.push({ file, line: 0, pattern: "tracked-env", sample: file });
    }
  }

  if (allHits.length > 0) {
    console.error("secrets scan FAIL:");
    for (const hit of allHits) {
      console.error(
        `  ${hit.file}:${hit.line} [${hit.pattern}] ${hit.sample.slice(0, 120)}`,
      );
    }
    process.exit(1);
  }
  console.log("secrets scan PASS");
}

main();
