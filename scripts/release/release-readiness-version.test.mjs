import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { readReleaseVersion } from "./read-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "release-readiness.yml",
);

describe("release-readiness workflow version alignment", () => {
  it("reads candidate version from VERSION via env steps (no stale hardcoded tags)", () => {
    const version = readReleaseVersion();
    const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");

    assert.match(
      workflow,
      /Read OSVA release version from VERSION/,
      "workflow must load VERSION before docker/helm/kind steps",
    );
    assert.match(
      workflow,
      /OSVA_IMAGE=osva:\$\{VERSION\}/,
      "workflow must set OSVA_IMAGE from VERSION",
    );
    assert.match(
      workflow,
      /--version "\$OSVA_RELEASE_VERSION"/,
      "Helm package must use OSVA_RELEASE_VERSION",
    );

    const forbiddenImageTag = `osva:1.0.0`;
    const forbiddenHelmVersion = `--version 1.0.0`;
    if (version !== "1.0.0") {
      assert.equal(
        workflow.includes(forbiddenImageTag),
        false,
        `release-readiness must not hardcode ${forbiddenImageTag} when VERSION is ${version}`,
      );
      assert.equal(
        workflow.includes(forbiddenHelmVersion),
        false,
        `release-readiness must not hardcode helm ${forbiddenHelmVersion} when VERSION is ${version}`,
      );
    }
  });
});
