#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLIC_NPM_PACKAGES, readReleaseVersion } from "./read-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function readMigrationHead() {
  const dir = path.join(REPO_ROOT, "packages", "db", "drizzle");
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const last = files.at(-1);
  if (!last) {
    return "unknown";
  }
  return last.replace(/\.sql$/, "");
}

function readGitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function main() {
  const version = readReleaseVersion();
  const inventory = {
    releaseVersion: version,
    status: "OSS Community release candidate (unpublished)",
    publicationStatus: "unpublished",
    sourceProvenance: {
      gitCommit: readGitHead(),
      versionFile: "VERSION",
    },
    pendingReleaseGates: [
      "release-readiness verify-core on RC commit",
      "release-readiness packages (npm/Python pack smoke)",
      "release-readiness oci-compose-helm",
      "release-readiness kind",
      "RC.3 pnpm verify:ci:clean clean-room gate",
      "maintainer authorization for tag and registry publish",
    ],
    ociImage: `osva:${version}`,
    helmChart: {
      path: "deploy/helm/osva",
      chartVersion: version,
      appVersion: version,
      packageCommand: `helm package deploy/helm/osva --version ${version} --app-version ${version}`,
    },
    npmPackages: PUBLIC_NPM_PACKAGES.map((name) => ({
      name,
      version,
      pack: `pnpm --filter ${name} pack`,
    })),
    pythonPackage: {
      name: "osva-sdk",
      version,
      path: "sdks/python",
    },
    migrationHead: readMigrationHead(),
    license: "Apache-2.0",
    thirdPartyLicenses: [
      "docs/release/THIRD_PARTY_LICENSES_NODE.md",
      "docs/release/THIRD_PARTY_LICENSES_PYTHON.md",
    ],
    supplyChainNotes: [
      "Secrets scan and license inventory run in release-readiness CI",
      "SBOM, container CVE scan, and artifact signing are not automated in-repo (RC.3 optional)",
    ],
    documentation: [
      "README.md",
      "docs/OSS-COMMUNITY-QUICKSTART.md",
      "docs/OSS-1.0-QUICKSTART.md",
      "docs/deployment/CONFIGURATION.md",
      "docs/architecture/DEPLOYMENT_TOPOLOGIES.md",
      "docs/operations/RUNBOOK.md",
      "docs/operations/UPGRADE.md",
      "docs/operations/BACKUP_AND_RECOVERY.md",
      "docs/release/COMPATIBILITY.md",
    ],
  };

  const outPath = path.join(
    REPO_ROOT,
    "docs",
    "release",
    "RELEASE_CANDIDATE_INVENTORY.json",
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(REPO_ROOT, outPath)}`);
  console.log("release candidate inventory PASS");
}

main();
