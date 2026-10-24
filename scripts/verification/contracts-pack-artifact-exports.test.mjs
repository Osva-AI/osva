import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("packed @osva-ai/contracts artifact blob exports", () => {
  it("exports ArtifactBlobStore types and ARTIFACT_STORAGE_DRIVER_REGISTERED from the root entry", () => {
    const script = path.join(
      REPO_ROOT,
      "scripts",
      "release",
      "contracts-pack-artifact-exports.mjs",
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: "pipe",
      env: process.env,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
