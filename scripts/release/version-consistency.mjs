#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PUBLIC_NPM_PACKAGES,
  packageJsonPath,
  readReleaseVersion,
} from "./read-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function readTomlVersion(pyprojectPath) {
  const text = fs.readFileSync(pyprojectPath, "utf8");
  const match = text.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Could not parse version from ${pyprojectPath}`);
  }
  return match[1];
}

function readChartYaml(chartPath) {
  const text = fs.readFileSync(chartPath, "utf8");
  const versionMatch = text.match(/^version:\s*([^\s#]+)/m);
  const appVersionMatch = text.match(/^appVersion:\s*"?([^"\s#]+)"?/m);
  if (!versionMatch || !appVersionMatch) {
    throw new Error(`Could not parse Chart.yaml at ${chartPath}`);
  }
  return { chartVersion: versionMatch[1], appVersion: appVersionMatch[1] };
}

function fail(message) {
  console.error(`version consistency FAIL: ${message}`);
  process.exit(1);
}

const expected = readReleaseVersion();
const failures = [];

for (const name of PUBLIC_NPM_PACKAGES) {
  const pkgPath = packageJsonPath(name);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (pkg.private === true) {
    failures.push(`${name} is still private`);
  }
  if (pkg.version !== expected) {
    failures.push(`${name} version is ${pkg.version}, expected ${expected}`);
  }
}

const pythonVersion = readTomlVersion(
  path.join(REPO_ROOT, "sdks", "python", "pyproject.toml"),
);
if (pythonVersion !== expected) {
  failures.push(`osva-sdk version is ${pythonVersion}, expected ${expected}`);
}

const chart = readChartYaml(
  path.join(REPO_ROOT, "deploy", "helm", "osva", "Chart.yaml"),
);
if (chart.chartVersion !== expected) {
  failures.push(
    `Helm chart version is ${chart.chartVersion}, expected ${expected}`,
  );
}
if (chart.appVersion !== expected) {
  failures.push(`Helm appVersion is ${chart.appVersion}, expected ${expected}`);
}

if (failures.length > 0) {
  for (const item of failures) {
    console.error(`  - ${item}`);
  }
  fail(`${failures.length} mismatch(es)`);
}

console.log(`version consistency PASS (${expected})`);
