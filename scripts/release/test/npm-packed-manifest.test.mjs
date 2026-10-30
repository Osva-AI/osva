import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  assertPublishablePackedManifest,
  collectForbiddenDependencySpecs,
  isForbiddenDependencySpec,
} from "../lib/npm-packed-manifest.mjs";
import { assertRefuseDirectoryPublish } from "../lib/npm-publish-plan.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const DEFECTIVE_FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "defective-v1-1-0-npm-manifests.json",
    ),
    "utf8",
  ),
);

describe("npm packed manifest validation", () => {
  it("rejects catalog: dependency specs", () => {
    assert.equal(isForbiddenDependencySpec("catalog:"), true);
    assert.equal(isForbiddenDependencySpec("4.6.7"), false);
  });

  it("rejects workspace:* dependency specs", () => {
    assert.equal(isForbiddenDependencySpec("workspace:*"), true);
    assert.equal(isForbiddenDependencySpec("1.1.0"), false);
  });

  it("rejects local path dependency specs", () => {
    assert.equal(isForbiddenDependencySpec("file:../contracts"), true);
    assert.equal(isForbiddenDependencySpec("link:../contracts"), true);
    assert.equal(isForbiddenDependencySpec("./packages/contracts"), true);
  });

  it("fails defective published v1.1.0 registry manifest fixtures", () => {
    for (const pkg of DEFECTIVE_FIXTURE.packages) {
      assert.throws(
        () =>
          assertPublishablePackedManifest(pkg, {
            expectedName: pkg.name,
            expectedVersion: pkg.version,
          }),
        /unsupported dependency protocols/,
        pkg.name,
      );
    }
  });

  it("accepts resolved semver dependency graph", () => {
    assertPublishablePackedManifest(
      {
        name: "@osva-ai/sdk",
        version: "1.1.0",
        publishConfig: { access: "public" },
        dependencies: {
          "@osva-ai/contracts": "1.1.0",
          "@osva-ai/runtime-protocol": "1.1.0",
          zod: "4.6.7",
        },
      },
      { expectedName: "@osva-ai/sdk", expectedVersion: "1.1.0" },
    );
  });

  it("refuses directory publish for monorepo source package.json files", () => {
    for (const dir of [
      "contracts",
      "runtime-protocol",
      "sdk",
      "connector-sdk",
      "cli",
    ]) {
      assert.throws(
        () =>
          assertRefuseDirectoryPublish(
            path.join(REPO_ROOT, "packages", dir, "package.json"),
          ),
        /Refusing directory publish/,
        dir,
      );
    }
  });

  it("collects all forbidden specs in install-relevant fields", () => {
    const violations = collectForbiddenDependencySpecs({
      dependencies: { zod: "catalog:" },
      peerDependencies: { "@osva-ai/contracts": "workspace:*" },
      optionalDependencies: { local: "file:./x" },
    });
    assert.equal(violations.length, 3);
  });
});
