import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

import { loadEnvironment } from "./environment.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("kind acceptance", () => {
  it("runs when OSVA_KIND_ACCEPTANCE is enabled", async () => {
    if (process.env.OSVA_KIND_ACCEPTANCE !== "true") {
      console.log(
        "SKIP kind acceptance: set OSVA_KIND_ACCEPTANCE=true (Linux CI release-readiness)",
      );
      return;
    }

    const env = await loadEnvironment();
    if (!env.docker?.version) {
      console.log("SKIP kind acceptance: Docker not found");
      return;
    }

    const script = path.join(
      REPO_ROOT,
      "scripts",
      "deployment",
      "kind-acceptance.mjs",
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, OSVA_KIND_ACCEPTANCE: "true" },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
