import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  PUBLIC_NPM_PACKAGES,
  assertNpmDistributionAlignedWithPlatform,
  packageJsonPath,
  readNpmDistributionVersion,
  readReleaseVersion,
} from "../read-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("platform vs npm distribution version alignment", () => {
  it("keeps platform VERSION and NPM_DISTRIBUTION_VERSION on the same major.minor line", () => {
    const platform = readReleaseVersion();
    const npm = readNpmDistributionVersion();
    assertNpmDistributionAlignedWithPlatform(platform, npm);
  });

  it("aligns public package.json versions with npm distribution only", () => {
    const npm = readNpmDistributionVersion();
    for (const name of PUBLIC_NPM_PACKAGES) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath(name), "utf8"));
      assert.equal(pkg.version, npm, name);
    }
  });

  it("passes release version-consistency script", () => {
    const platform = readReleaseVersion();
    const npm = readNpmDistributionVersion();
    const script = path.join(
      REPO_ROOT,
      "scripts",
      "release",
      "version-consistency.mjs",
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const expected =
      platform === npm
        ? new RegExp(`version consistency PASS \\(${platform.replaceAll(".", "\\.")}\\)`)
        : new RegExp(
            `platform ${platform.replaceAll(".", "\\.")}, npm distribution ${npm.replaceAll(".", "\\.")}`,
          );
    assert.match(result.stdout, expected);
  });
});
