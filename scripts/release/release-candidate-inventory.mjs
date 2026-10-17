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

/** Tag-target commit for published v1.1.0-rc.2 (M10.4D). */
const RC2_RELEASE_COMMIT = "6bc970f03d364da35aaeb1fe8aaaa3218986b27f";

const RC2_PUBLISHED = {
  gitTag: "v1.1.0-rc.2",
  gitHubReleaseUrl: "https://github.com/Osva-AI/osva/releases/tag/v1.1.0-rc.2",
  publishedAt: "2026-10-17T09:45:21Z",
  releaseCommit: RC2_RELEASE_COMMIT,
  ociIndexDigest:
    "sha256:02e11050fe359c7c6e02003ae6d213163191da3e05da42e8fb5a450f2309ac8e",
  linuxAmd64ManifestDigest:
    "sha256:302a505636236b970c3746cb728b0059ae58286f8dcbea90ed4b3275a0c1d04f",
  m10_4eRegistryAcceptance: "passed",
};

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

/** PEP 440 wheel/sdist filenames (for example 1.1.0-rc.2 → 1.1.0rc2). */
function pep440ArtifactVersion(version) {
  const match = version.match(/^(\d+\.\d+\.\d+)-([a-zA-Z]+)\.(\d+)$/);
  if (match) {
    const [, base, label, num] = match;
    return `${base}${label}${num}`;
  }
  return version;
}

function buildInventory(version) {
  const isRc2Published = version === "1.1.0-rc.2";

  const base = {
    releaseVersion: version,
    status: isRc2Published
      ? "OSS Community release candidate RC2 published and registry-verified"
      : "OSS Community release candidate prepared (unpublished)",
    publicationStatus: isRc2Published ? "published" : "unpublished",
    sourceProvenance: {
      gitCommit: readGitHead(),
      versionFile: "VERSION",
      note: "gitCommit identifies the committed release-content state at generation time. The inventory file may be recorded in a subsequent metadata-only commit.",
    },
    priorPublishedRelease: {
      version: "1.1.0-rc.1",
      publicationStatus: "published",
      cliIncludesM10_2AgentWorkflow: false,
      note: "npm @osva-ai/cli@1.1.0-rc.1 predates init/validate/deploy/run/status/doctor and bundled templates.",
    },
    pendingReleaseGates: isRc2Published
      ? []
      : [
          "release-readiness verify-core on RC commit",
          "release-readiness packages (npm/Python pack smoke)",
          "release-readiness oci-compose-helm",
          "release-readiness kind",
          "RC.3 pnpm verify:ci:clean clean-room gate",
          "maintainer authorization for tag and registry publish",
        ],
    ociImage: `osva:${version}`,
    ociImageGhcr: `ghcr.io/osva-ai/osva:${version}`,
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
      pep440ArtifactVersion: pep440ArtifactVersion(version),
      pipInstallExample: `pip install osva-sdk==${pep440ArtifactVersion(version)}`,
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
      "docs/release/M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md",
    ],
  };

  if (isRc2Published) {
    return {
      ...base,
      publishedRelease: {
        gitTag: RC2_PUBLISHED.gitTag,
        gitHubReleaseUrl: RC2_PUBLISHED.gitHubReleaseUrl,
        publishedAt: RC2_PUBLISHED.publishedAt,
        releaseCommit: RC2_PUBLISHED.releaseCommit,
      },
      registryArtifacts: {
        npmVersion: version,
        npmDistTagRc: version,
        npmDistTagLatest: "1.0.0",
        pypiVersion: pep440ArtifactVersion(version),
        ghcrTag: base.ociImageGhcr,
        ociIndexDigest: RC2_PUBLISHED.ociIndexDigest,
        linuxAmd64ManifestDigest: RC2_PUBLISHED.linuxAmd64ManifestDigest,
      },
      completedReleaseGates: [
        "GitHub CI on release commit (merged RC2 PR)",
        "release-readiness workflow on release commit (verify-core, packages, oci-compose-helm, kind)",
        "Maintainer tag v1.1.0-rc.2 and registry publication (M10.4D)",
        "M10.4C local RC2 distribution acceptance",
        "M10.4E published-registry acceptance",
      ],
      releaseGateQualification: {
        pnpmVerifyCiCleanLocalRerun: "not_rerun_during_m10_4_closeout",
        note: "pnpm verify:ci:clean was not rerun locally during M10.4 closeout. Required CI and release-readiness checks passed on the release commit before merge and publication; published artifacts passed isolated registry acceptance (M10.4E).",
      },
      acceptance: {
        m10_4Status: "complete",
        m10_4cLocalDistribution: "passed",
        m10_4eRegistryAcceptance: RC2_PUBLISHED.m10_4eRegistryAcceptance,
        summaryDocument: "docs/release/M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md",
      },
      sourceProvenance: {
        ...base.sourceProvenance,
        releaseCommit: RC2_PUBLISHED.releaseCommit,
        note: "releaseCommit is the git tag target for v1.1.0-rc.2. gitCommit is the tree state when this inventory file was generated.",
      },
    };
  }

  return base;
}

function main() {
  const version = readReleaseVersion();
  const inventory = buildInventory(version);

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
