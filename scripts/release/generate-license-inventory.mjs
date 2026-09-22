#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const OUTPUT_DIR = path.join(REPO_ROOT, "docs", "release");
const NODE_OUTPUT = path.join(OUTPUT_DIR, "THIRD_PARTY_LICENSES_NODE.md");
const PYTHON_OUTPUT = path.join(OUTPUT_DIR, "THIRD_PARTY_LICENSES_PYTHON.md");

const PERMISSIVE = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Unlicense",
  "Python-2.0",
  "CC0-1.0",
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    shell: process.platform === "win32" && command === "pnpm",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

function normalizeLicense(value) {
  if (!value || value === "UNKNOWN") {
    return "UNKNOWN";
  }
  return value.replace(/\s+/g, " ").trim();
}

function renderNodeInventory(rows) {
  const unknown = rows.filter((row) => !PERMISSIVE.has(row.license));
  const lines = [
    "# Third-party licenses — Node (production dependencies)",
    "",
    "Generated from `pnpm-lock.yaml` and workspace package metadata.",
    "Re-generate with `node scripts/release/generate-license-inventory.mjs`.",
    "",
    "| Package | Version | License |",
    "| --- | --- | --- |",
  ];
  for (const row of rows) {
    const flag =
      row.license === "UNKNOWN" || !PERMISSIVE.has(row.license) ? " ⚠️" : "";
    lines.push(`| ${row.name} | ${row.version} | ${row.license}${flag} |`);
  }
  lines.push("");
  if (unknown.length > 0) {
    lines.push(
      "## Review required",
      "",
      "The following production dependencies are not in the default permissive allow-list:",
      "",
    );
    for (const row of unknown) {
      lines.push(`- \`${row.name}@${row.version}\` — ${row.license}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function collectPnpmProductionLicenses() {
  const stdout = run("pnpm", ["licenses", "list", "--prod", "--json"]);
  const parsed = JSON.parse(stdout);
  const byKey = new Map();
  for (const [license, packages] of Object.entries(parsed)) {
    for (const entry of packages) {
      const name = entry.name;
      const versions = entry.versions ?? [];
      const version = versions[0] ?? "unknown";
      const key = `${name}@${version}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          name,
          version,
          license: normalizeLicense(license),
        });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function collectPythonLicenses() {
  const stdout = run("python", ["-m", "pip", "install", "pip-licenses", "-q"]);
  void stdout;
  const report = run(
    "python",
    [
      "-m",
      "pip",
      "install",
      "-q",
      "-e",
      path.join(REPO_ROOT, "sdks", "python"),
    ],
    { cwd: REPO_ROOT },
  );
  void report;
  const licenses = run("python", [
    "-m",
    "piplicenses",
    "--from",
    "mixed",
    "--format",
    "json",
    "-p",
    path.join(REPO_ROOT, "sdks", "python"),
  ]);
  const parsed = JSON.parse(licenses);
  return parsed
    .map((row) => ({
      name: row.Name,
      version: row.Version,
      license: normalizeLicense(row.License),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function renderPythonInventory(rows) {
  const unknown = rows.filter((row) => !PERMISSIVE.has(row.license));
  const lines = [
    "# Third-party licenses — Python SDK",
    "",
    "Generated from `sdks/python/pyproject.toml` resolved dependencies.",
    "Re-generate with `node scripts/release/generate-license-inventory.mjs`.",
    "",
    "| Package | Version | License |",
    "| --- | --- | --- |",
  ];
  for (const row of rows) {
    const flag =
      row.license === "UNKNOWN" || !PERMISSIVE.has(row.license) ? " ⚠️" : "";
    lines.push(`| ${row.name} | ${row.version} | ${row.license}${flag} |`);
  }
  lines.push("");
  if (unknown.length > 0) {
    lines.push("## Review required", "");
    for (const row of unknown) {
      lines.push(`- \`${row.name}@${row.version}\` — ${row.license}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const nodeRows = collectPnpmProductionLicenses();
  const pythonRows = collectPythonLicenses();
  fs.writeFileSync(NODE_OUTPUT, renderNodeInventory(nodeRows), "utf8");
  fs.writeFileSync(PYTHON_OUTPUT, renderPythonInventory(pythonRows), "utf8");
  console.log(`Wrote ${path.relative(REPO_ROOT, NODE_OUTPUT)}`);
  console.log(`Wrote ${path.relative(REPO_ROOT, PYTHON_OUTPUT)}`);
  const flagged = [
    ...nodeRows.filter((r) => !PERMISSIVE.has(r.license)),
    ...pythonRows.filter((r) => !PERMISSIVE.has(r.license)),
  ];
  if (flagged.some((r) => r.license === "UNKNOWN")) {
    console.error(
      "license inventory: UNKNOWN licenses present — review required",
    );
    process.exit(1);
  }
  console.log("license inventory generation PASS");
}

main();
