import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { checkComposeDistributionConsistency } from "../lib/compose-distribution-consistency.mjs";
import { readReleaseVersion } from "../read-version.mjs";
import { readRepositoryMigrationHead } from "../lib/read-migration-head.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("compose distribution consistency", () => {
  it("aligns distribution manifest image tag with platform VERSION", () => {
    const result = checkComposeDistributionConsistency();
    const platformVersion = readReleaseVersion();

    assert.equal(
      result.details.distributionPlatformVersion,
      platformVersion,
      "platformVersion mismatch in distribution.json",
    );

    const tag = result.details.distributionImageRef.split(":").at(-1);
    assert.equal(tag, platformVersion);
    assert.match(
      result.details.distributionImageRef,
      new RegExp(`:${platformVersion.replaceAll(".", "\\.")}$`),
    );
  });

  it("lists repository and distribution migration heads in details", () => {
    const result = checkComposeDistributionConsistency();
    assert.equal(
      result.details.repositoryMigrationHead,
      readRepositoryMigrationHead(),
    );
    assert.ok(
      result.details.distributionMigrationHead.length > 0,
      "distribution.json must declare migrationHead",
    );
  });

  it("runs compose-distribution-consistency script", () => {
    const expected = checkComposeDistributionConsistency();
    const script = path.join(
      REPO_ROOT,
      "scripts",
      "release",
      "compose-distribution-consistency.mjs",
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      expected.ok ? 0 : 1,
      result.stderr || result.stdout,
    );
    if (expected.ok) {
      assert.match(result.stdout, /compose distribution consistency PASS/);
    } else {
      assert.match(result.stderr, /compose distribution consistency FAIL/);
    }
  });
});
