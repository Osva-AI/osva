#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readReleaseVersion } from "./read-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function runNode(script, env = {}) {
  const scriptPath = path.join(REPO_ROOT, "scripts", script);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runPnpm(script) {
  const result = spawnSync("pnpm", [script], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const version = readReleaseVersion();
process.env.OSVA_IMAGE = process.env.OSVA_IMAGE ?? `osva:${version}`;
process.env.OSVA_DEPLOY_ACCEPTANCE = "true";
console.log(`OSS 1.0 release candidate acceptance (${version})`);

runNode("release/version-consistency.mjs");
runNode("release/docs-link-check.mjs");
runNode("release/secrets-scan.mjs");
runNode("release/generate-license-inventory.mjs");
runNode("release/npm-pack-smoke.mjs");
runNode("release/python-pack-smoke.mjs");
runNode("release/release-candidate-inventory.mjs");

runPnpm("db:migrations:verify");

runNode("deployment/verify-runtime-image.mjs");
runNode("deployment/docker-image-smoke.mjs");
runNode("deployment/deploy-compose-acceptance.mjs");

const helmTest = spawnSync(
  process.execPath,
  ["--test", "scripts/verification/helm-chart.test.mjs"],
  { cwd: REPO_ROOT, stdio: "inherit" },
);
if (helmTest.status !== 0) {
  process.exit(helmTest.status ?? 1);
}

if (process.env.OSVA_KIND_ACCEPTANCE === "true") {
  runNode("deployment/kind-acceptance.mjs");
} else {
  console.log(
    "SKIP kind acceptance locally (set OSVA_KIND_ACCEPTANCE=true to run)",
  );
}

console.log("release acceptance orchestration PASS");
