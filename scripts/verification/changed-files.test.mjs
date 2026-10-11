import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { affectedPackages, mergeChangedPathGroups } from "./changed-files.mjs";

const SAMPLE_PACKAGES = [
  { name: "@osva/web", dir: "apps/web" },
  { name: "@osva/contracts", dir: "packages/contracts" },
  { name: "@osva/memory", dir: "adapters/memory" },
];

describe("changed file selection", () => {
  it("maps changed paths to affected workspace packages", () => {
    const result = affectedPackages(
      ["apps/web/src/page.tsx", "packages/contracts/src/index.ts"],
      SAMPLE_PACKAGES,
    );
    assert.equal(result.global, false);
    assert.deepEqual(result.names, ["@osva/contracts", "@osva/web"]);
  });

  it("includes deleted package paths in affected selection", () => {
    const result = affectedPackages(
      ["adapters/memory/src/deleted-module.ts"],
      SAMPLE_PACKAGES,
    );
    assert.equal(result.global, false);
    assert.deepEqual(result.names, ["@osva/memory"]);
  });

  it("falls back to global verification for root configuration changes", () => {
    const result = affectedPackages(
      ["turbo.json", "apps/web/foo.ts"],
      SAMPLE_PACKAGES,
    );
    assert.equal(result.global, true);
    assert.deepEqual(result.names, ["@osva/web"]);
  });

  it("reports no workspace packages for unrelated changes", () => {
    const result = affectedPackages(
      ["docs/README.md", "scripts/foo.mjs"],
      SAMPLE_PACKAGES,
    );
    assert.equal(result.global, false);
    assert.deepEqual(result.names, []);
  });

  it("merges path groups with no duplicates", () => {
    const merged = mergeChangedPathGroups(
      ["apps/web/a.ts"],
      ["apps/web/a.ts", "apps/web/b.ts"],
      [],
      ["adapters/memory/old.ts"],
      [],
    );
    assert.deepEqual(merged, [
      "adapters/memory/old.ts",
      "apps/web/a.ts",
      "apps/web/b.ts",
    ]);
  });

  it("treats an empty merge as no changed paths", () => {
    assert.deepEqual(mergeChangedPathGroups([], [], []), []);
  });
});
