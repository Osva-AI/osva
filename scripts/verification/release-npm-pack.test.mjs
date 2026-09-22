import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("release npm pack smoke", () => {
  it("runs when OSVA_RELEASE_ACCEPTANCE is enabled", () => {
    if (process.env.OSVA_RELEASE_ACCEPTANCE !== "true") {
      console.log(
        "SKIP npm pack smoke: set OSVA_RELEASE_ACCEPTANCE=true to run",
      );
      return;
    }

    const script = path.join(
      REPO_ROOT,
      "scripts",
      "release",
      "npm-pack-smoke.mjs",
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: "pipe",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
