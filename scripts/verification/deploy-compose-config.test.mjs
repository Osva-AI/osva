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
const COMPOSE_DIR = path.join(REPO_ROOT, "deploy", "compose");

describe("self-hosted compose distribution", () => {
  it("validates deploy/compose/compose.yml", async () => {
    const env = await loadEnvironment();
    if (!env.docker?.version) {
      console.log("SKIP compose config test: Docker not found");
      return;
    }

    const composeCmd = env.docker.source ?? "docker";
    const result = spawnSync(
      composeCmd,
      ["compose", "-f", path.join(COMPOSE_DIR, "compose.yml"), "config"],
      {
        cwd: COMPOSE_DIR,
        encoding: "utf8",
        env: {
          ...process.env,
          POSTGRES_PASSWORD: "compose-config-test-password",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /osva-self-hosted/);
    assert.match(result.stdout, /OSVA_CONTAINER_ENABLED: "false"/);
  });
});
