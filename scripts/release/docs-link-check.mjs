#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const SCAN_ROOTS = [
  path.join(REPO_ROOT, "docs"),
  path.join(REPO_ROOT, "README.md"),
  path.join(REPO_ROOT, "SECURITY.md"),
  path.join(REPO_ROOT, "CHANGELOG.md"),
  path.join(REPO_ROOT, "deploy"),
];

const LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g;

function collectMarkdownFiles(entryPath, out = []) {
  if (!fs.existsSync(entryPath)) {
    return out;
  }
  const stat = fs.statSync(entryPath);
  if (stat.isFile() && entryPath.endsWith(".md")) {
    out.push(entryPath);
    return out;
  }
  if (!stat.isDirectory()) {
    return out;
  }
  for (const name of fs.readdirSync(entryPath)) {
    collectMarkdownFiles(path.join(entryPath, name), out);
  }
  return out;
}

function resolveTarget(fromFile, target) {
  if (
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:")
  ) {
    return null;
  }
  const cleaned = target.split("#")[0].trim();
  if (!cleaned || cleaned.startsWith("<")) {
    return null;
  }
  const baseDir = path.dirname(fromFile);
  return path.normalize(path.join(baseDir, cleaned));
}

function main() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    collectMarkdownFiles(root, files);
  }
  const missing = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    let match;
    while ((match = LINK_RE.exec(text)) !== null) {
      const resolved = resolveTarget(file, match[1]);
      if (!resolved) {
        continue;
      }
      if (!fs.existsSync(resolved)) {
        missing.push({
          file: path.relative(REPO_ROOT, file),
          target: match[1],
          resolved: path.relative(REPO_ROOT, resolved),
        });
      }
    }
  }
  if (missing.length > 0) {
    console.error("docs link check FAIL:");
    for (const item of missing) {
      console.error(`  ${item.file}: (${item.target}) -> ${item.resolved}`);
    }
    process.exit(1);
  }
  console.log(`docs link check PASS (${files.length} markdown files)`);
}

main();
