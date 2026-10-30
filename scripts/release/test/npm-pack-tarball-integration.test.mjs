import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { packPublicNpmPackages } from "../lib/npm-pack-public.mjs";
import { readPackageJsonFromTarball } from "../lib/npm-packed-manifest.mjs";
import { readNpmDistributionVersion } from "../read-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("pnpm pack tarball integration", () => {
  it("resolves catalog: and workspace:* inside packed package.json", () => {
    if (process.env.OSVA_RELEASE_ACCEPTANCE !== "true") {
      console.log(
        "SKIP pack integration: set OSVA_RELEASE_ACCEPTANCE=true to run",
      );
      return;
    }

    const version = readNpmDistributionVersion();
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "osva-pack-test-"));
    const artifacts = packPublicNpmPackages({
      repoRoot: REPO_ROOT,
      version,
      packDestination: packDir,
      runBuild: true,
    });

    const sdk = artifacts.get("@osva-ai/sdk");
    assert.ok(sdk);
    const manifest = readPackageJsonFromTarball(sdk.tarballPath);
    assert.equal(manifest.dependencies?.zod, "4.6.7");
    assert.equal(manifest.dependencies?.["@osva-ai/contracts"], version);
    assert.equal(manifest.dependencies?.["@osva-ai/runtime-protocol"], version);
    assert.doesNotMatch(
      JSON.stringify(manifest.dependencies),
      /catalog:|workspace:/,
    );
  });
});
