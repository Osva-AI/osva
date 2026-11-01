import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

import { loadEnvironment } from "./environment.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CLI_TEMPLATE_DIR = path.join(
  REPO_ROOT,
  "packages",
  "cli",
  "templates",
  "compose-install",
);

function composeConfigTestEnv(overrides = {}) {
  const env = {
    ...process.env,
    POSTGRES_PASSWORD: "compose-config-test-password",
    OSVA_AUTH_SECRET: "compose-config-test-osva-auth-secret-32",
    OSVA_IMAGE: "ghcr.io/osva-ai/osva:1.1.1",
    OSVA_RUNTIME_CAPABILITY_SECRET: "a".repeat(64),
    OSVA_RUNTIME_CAPABILITY_PORT: "8787",
    OSVA_PUBLISH_RUNTIME_CAPABILITY_PORT: "8787",
    OSVA_RUNTIME_CAPABILITY_BASE_URL: "http://127.0.0.1:8787",
    OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS: "true",
    ...overrides,
  };
  delete env.COMPOSE_PROJECT_NAME;
  return env;
}

describe("CLI remote-http-dev compose overlay", () => {
  it("bundled overlay publishes capability port on loopback only", () => {
    const overlay = fs.readFileSync(
      path.join(CLI_TEMPLATE_DIR, "compose.remote-http-dev.yml"),
      "utf8",
    );
    assert.match(
      overlay,
      /127\.0\.0\.1:\$\{OSVA_PUBLISH_RUNTIME_CAPABILITY_PORT/,
    );
    assert.match(overlay, /OSVA_RUNTIME_CAPABILITY_SECRET/);
    assert.match(overlay, /host\.docker\.internal:host-gateway/);
  });

  it("default install compose omits runtime capability wiring", () => {
    const base = fs.readFileSync(
      path.join(CLI_TEMPLATE_DIR, "compose.yml"),
      "utf8",
    );
    assert.doesNotMatch(base, /OSVA_RUNTIME_CAPABILITY_SECRET/);
    assert.doesNotMatch(base, /OSVA_PUBLISH_RUNTIME_CAPABILITY_PORT/);
  });

  it("validates merged compose config when profile env is complete", async () => {
    const env = await loadEnvironment();
    if (!env.docker?.version) {
      console.log("SKIP remote-http-dev compose config test: Docker not found");
      return;
    }

    const composeCmd = env.docker.source ?? "docker";
    const result = spawnSync(
      composeCmd,
      [
        "compose",
        "-f",
        path.join(CLI_TEMPLATE_DIR, "compose.yml"),
        "-f",
        path.join(CLI_TEMPLATE_DIR, "compose.remote-http-dev.yml"),
        "config",
      ],
      {
        cwd: CLI_TEMPLATE_DIR,
        encoding: "utf8",
        env: composeConfigTestEnv(),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /OSVA_RUNTIME_CAPABILITY_SECRET/);
    assert.match(result.stdout, /127\.0\.0\.1:8787/);
    assert.match(
      result.stdout,
      /OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS: "true"/,
    );
  });

  it("fails merged config when capability secret is missing", async () => {
    const env = await loadEnvironment();
    if (!env.docker?.version) {
      console.log("SKIP remote-http-dev missing secret test: Docker not found");
      return;
    }

    const composeCmd = env.docker.source ?? "docker";
    const envWithoutSecret = composeConfigTestEnv();
    delete envWithoutSecret.OSVA_RUNTIME_CAPABILITY_SECRET;
    const result = spawnSync(
      composeCmd,
      [
        "compose",
        "-f",
        path.join(CLI_TEMPLATE_DIR, "compose.yml"),
        "-f",
        path.join(CLI_TEMPLATE_DIR, "compose.remote-http-dev.yml"),
        "config",
      ],
      {
        cwd: CLI_TEMPLATE_DIR,
        encoding: "utf8",
        env: envWithoutSecret,
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr + result.stdout,
      /OSVA_RUNTIME_CAPABILITY_SECRET is required/,
    );
  });
});
