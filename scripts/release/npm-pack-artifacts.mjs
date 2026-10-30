#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateContractsTarballArtifactExports } from "./contracts-pack-artifact-exports.mjs";
import {
  formatArtifactManifestRecord,
  packPublicNpmPackages,
} from "./lib/npm-pack-public.mjs";
import { readNpmDistributionVersion } from "./read-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function main() {
  const version = readNpmDistributionVersion();
  const outDir =
    process.env.OSVA_NPM_ARTIFACT_DIR?.trim() ||
    path.join(REPO_ROOT, ".release", "npm-artifacts", version);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Pack public npm artifacts (release ${version}) -> ${outDir}`);

  const artifacts = packPublicNpmPackages({
    repoRoot: REPO_ROOT,
    version,
    packDestination: outDir,
    runBuild: true,
  });

  const contracts = artifacts.get("@osva-ai/contracts");
  if (contracts) {
    validateContractsTarballArtifactExports(contracts.tarballPath);
    console.log(
      "validated @osva-ai/contracts packed artifact blob root exports",
    );
  }

  const record = formatArtifactManifestRecord(artifacts, version);
  const manifestPath = path.join(outDir, "artifact-manifest.json");
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );

  for (const entry of record.packages) {
    console.log(`${entry.name}: ${entry.fileName} sha256=${entry.sha256}`);
  }
  console.log(`artifact manifest: ${manifestPath}`);
  console.log("npm pack artifacts PASS");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
