#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateContractsTarballArtifactExports } from "./contracts-pack-artifact-exports.mjs";
import { runIsolatedNpmConsumerSmoke } from "./lib/npm-consumer-smoke.mjs";
import { runCommand } from "./lib/npm-command.mjs";
import { packPublicNpmPackages } from "./lib/npm-pack-public.mjs";
import { readNpmDistributionVersion } from "./read-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function main() {
  const version = readNpmDistributionVersion();
  console.log(`npm pack smoke (release ${version})`);

  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "osva-npm-pack-"));
  const artifacts = packPublicNpmPackages({
    repoRoot: REPO_ROOT,
    version,
    packDestination: packDir,
    runBuild: true,
  });

  const contracts = artifacts.get("@osva-ai/contracts");
  if (contracts) {
    validateContractsTarballArtifactExports(contracts.tarballPath);
    console.log(
      "validated @osva-ai/contracts packed artifact blob root exports",
    );
  }

  for (const [name] of artifacts) {
    const dir = name.replace(/^@osva-ai\//, "");
    const dry = runCommand("npm", ["pack", "--dry-run"], {
      cwd: path.join(REPO_ROOT, "packages", dir),
    });
    if (dry.includes("node_modules/typescript")) {
      throw new Error(`${name} pack dry-run includes dev tooling`);
    }
    if (name === "@osva-ai/cli") {
      if (!dry.includes("templates/agent-typescript")) {
        throw new Error(
          "@osva-ai/cli pack dry-run missing agent-typescript templates",
        );
      }
      const cliPkg = JSON.parse(
        fs.readFileSync(
          path.join(REPO_ROOT, "packages", "cli", "package.json"),
          "utf8",
        ),
      );
      if (!cliPkg.dependencies?.ajv) {
        throw new Error("@osva-ai/cli package.json missing ajv dependency");
      }
    }
    const entry = artifacts.get(name);
    console.log(`packed ${name} -> ${entry.fileName} (sha256=${entry.sha256})`);
  }

  const { help } = runIsolatedNpmConsumerSmoke(artifacts, version);

  for (const command of [
    "init",
    "validate",
    "deploy",
    "run",
    "status",
    "doctor",
    "setup",
  ]) {
    if (!help.includes(command)) {
      throw new Error(`CLI help missing M10.2 command: ${command}`);
    }
  }

  console.log("npm pack smoke PASS");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
