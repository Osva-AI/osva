#!/usr/bin/env node
/**
 * Optional RC.4 published npm evidence. Exit 0 when all @rc packages match VERSION.
 * Exit 3 = NOT_RUN (registry unreachable). Exit 1 = mismatch or partial failure.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PUBLIC_NPM_PACKAGES,
  readReleaseVersion,
} from "../../../release/read-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const NPM_TIMEOUT_MS = 30_000;

function npmViewVersion(packageName) {
  const result = spawnSync(
    "npm",
    ["view", `${packageName}@rc`, "version", "--json"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: NPM_TIMEOUT_MS,
      shell: process.platform === "win32",
    },
  );
  if (result.error?.code === "ETIMEDOUT" || result.status === 124) {
    return { kind: "unreachable" };
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    if (
      message.includes("EAI_AGAIN") ||
      message.includes("ENOTFOUND") ||
      message.includes("401") ||
      message.includes("403") ||
      result.status === 1
    ) {
      return { kind: "unreachable", detail: message.slice(0, 200) };
    }
    return { kind: "fail", detail: message.slice(0, 400) };
  }
  try {
    const parsed = JSON.parse(result.stdout.trim());
    const version = Array.isArray(parsed) ? parsed[0] : parsed;
    return { kind: "ok", version: String(version) };
  } catch {
    return {
      kind: "fail",
      detail: `Unexpected npm output: ${result.stdout.trim().slice(0, 200)}`,
    };
  }
}

const expected = readReleaseVersion();
/** @type {string[]} */
const failures = [];
let unreachable = false;

for (const name of PUBLIC_NPM_PACKAGES) {
  const outcome = npmViewVersion(name);
  if (outcome.kind === "unreachable") {
    unreachable = true;
    console.warn(
      `NOT_RUN: unable to query ${name}@rc (${outcome.detail ?? "network"})`,
    );
    continue;
  }
  if (outcome.kind === "fail") {
    failures.push(`${name}: ${outcome.detail ?? "npm view failed"}`);
    continue;
  }
  if (outcome.version !== expected) {
    failures.push(`${name}@rc is ${outcome.version}, expected ${expected}`);
  } else {
    console.log(`PASS ${name}@rc → ${outcome.version}`);
  }
}

if (unreachable && failures.length === 0) {
  console.log(
    "RC4 registry npm check NOT_RUN (registry unreachable; use RC4_VERIFICATION.md maintainer record)",
  );
  process.exit(3);
}

if (failures.length > 0) {
  console.error("RC4 registry npm check FAIL:");
  for (const line of failures) {
    console.error(`  - ${line}`);
  }
  process.exit(1);
}

console.log(`RC4 registry npm check PASS (${expected})`);
process.exit(0);
