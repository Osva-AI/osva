#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createPublishedNpmConsumer } from "../acceptance/r11-registry-only/lib/published-npm-consumer.mjs";
import { auditNpmRegistryDependencyManifests } from "./lib/npm-registry-manifest-audit.mjs";
import {
  readNpmDistributionVersion,
  readReleaseVersion,
} from "./read-version.mjs";

async function main() {
  const platformVersion = readReleaseVersion();
  const npmVersion = readNpmDistributionVersion();
  const installVersion =
    process.env.OSVA_NPM_CONSUMER_VERSION?.trim() || npmVersion;
  console.log(
    `npm registry consumer smoke (platform ${platformVersion}, npm ${installVersion})`,
  );

  auditNpmRegistryDependencyManifests(
    installVersion,
    " (registry consumer smoke)",
  );
  for (const name of [
    "@osva-ai/contracts",
    "@osva-ai/runtime-protocol",
    "@osva-ai/sdk",
    "@osva-ai/connector-sdk",
    "@osva-ai/cli",
  ]) {
    console.log(`registry manifest ok: ${name}@${installVersion}`);
  }

  const consumer = await createPublishedNpmConsumer(installVersion);
  try {
    const cliBin = path.join(
      consumer.installRoot,
      "node_modules",
      "@osva-ai",
      "cli",
      "dist",
      "bin",
      "osva.js",
    );
    if (!fs.existsSync(cliBin)) {
      throw new Error("CLI bin missing from registry consumer install");
    }
    const help = spawnSync(process.execPath, [cliBin, "help"], {
      cwd: consumer.installRoot,
      encoding: "utf8",
    });
    if (help.status !== 0 || !help.stdout.includes("Usage:")) {
      throw new Error("CLI help failed from registry install");
    }
    console.log("npm registry consumer smoke PASS");
  } finally {
    await consumer.dispose();
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
