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

describe("deploy compose acceptance", () => {
  it("runs full stack when OSVA_DEPLOY_ACCEPTANCE is enabled", async () => {
    if (process.env.OSVA_DEPLOY_ACCEPTANCE !== "true") {
      console.log(
        "SKIP deploy compose acceptance: set OSVA_DEPLOY_ACCEPTANCE=true to run",
      );
      return;
    }

    const env = await loadEnvironment();
    if (!env.docker?.version) {
      console.log("SKIP deploy compose acceptance: Docker not found");
      return;
    }

    const script = path.join(
      REPO_ROOT,
      "scripts",
      "deployment",
      "deploy-compose-acceptance.mjs",
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 60 * 60 * 1000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
