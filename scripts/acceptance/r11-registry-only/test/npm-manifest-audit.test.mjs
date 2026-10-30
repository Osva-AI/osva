import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { assertPublishablePackedManifest } from "../../../release/lib/npm-packed-manifest.mjs";

const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../release/test/fixtures/defective-v1-1-0-npm-manifests.json",
    ),
    "utf8",
  ),
);

describe("registry npm manifest audit fixtures", () => {
  it("detects defective stable 1.1.0 npm dependency protocols", () => {
    for (const pkg of FIXTURE.packages) {
      assert.throws(
        () =>
          assertPublishablePackedManifest(pkg, {
            expectedName: pkg.name,
            expectedVersion: "1.1.0",
          }),
        /unsupported dependency protocols/,
      );
    }
  });
});
