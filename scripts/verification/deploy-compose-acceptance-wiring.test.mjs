import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, it } from "node:test";

import {
  COMPOSE_PARSE_ENV_KEYS,
  EXPECTED_MIGRATION_HEAD,
  buildComposeAcceptanceEnv,
} from "../deployment/deploy-compose-acceptance-env.mjs";
import { loadEnvironment } from "./environment.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const COMPOSE_DIR = path.join(REPO_ROOT, "deploy", "compose");
const ACCEPTANCE_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "deployment",
  "deploy-compose-acceptance.mjs",
);

describe("deploy compose acceptance wiring", () => {
  it("expects migration head 0026_better_auth_user_image", () => {
    assert.equal(EXPECTED_MIGRATION_HEAD, "0026_better_auth_user_image");
  });

  it("builds a complete Compose parse environment with test defaults", () => {
    const composeEnv = buildComposeAcceptanceEnv({});
    for (const key of COMPOSE_PARSE_ENV_KEYS) {
      assert.ok(
        composeEnv[key],
        `missing ${key} in compose acceptance environment`,
      );
    }
    assert.match(composeEnv.OSVA_AUTH_BASE_URL, /^http:\/\/127\.0\.0\.1:/);
    assert.equal(
      composeEnv.OSVA_AUTH_TRUSTED_ORIGINS,
      composeEnv.OSVA_AUTH_BASE_URL,
    );
  });

  it("passes complete composeEnv to status, logs, and teardown paths", () => {
    const source = fs.readFileSync(ACCEPTANCE_SCRIPT, "utf8");
    assert.match(source, /function assertServicesRunning\(composeEnv\)/);
    assert.match(source, /function assertStartupLogs\(composeEnv\)/);
    assert.doesNotMatch(
      source,
      /env:\s*\{\s*POSTGRES_PASSWORD:\s*password\s*\}/,
    );
    assert.match(source, /assertServicesRunning\(composeEnv\)/g);
    assert.ok(
      (source.match(/assertServicesRunning\(composeEnv\)/g) ?? []).length >= 2,
      "expected two assertServicesRunning(composeEnv) calls",
    );
    assert.match(source, /assertStartupLogs\(composeEnv\)/);
    assert.match(
      source,
      /buildComposeAcceptanceEnv\(process\.env\)/,
      "failure cleanup should rebuild full compose env",
    );
    const downCalls = source.match(
      /run\(\s*"docker",\s*\[\s*"compose",\s*"down",\s*"-v"\s*\],\s*\{\s*env:\s*composeEnv\s*\}/g,
    );
    assert.ok(
      downCalls && downCalls.length >= 2,
      "success and tearDown paths should use composeEnv for compose down",
    );
  });

  it("does not log the authentication secret from the acceptance script", () => {
    const source = fs.readFileSync(ACCEPTANCE_SCRIPT, "utf8");
    assert.doesNotMatch(source, /console\.log\([^)]*OSVA_AUTH_SECRET/);
    assert.doesNotMatch(
      source,
      /console\.log\([^)]*composeEnv\.OSVA_AUTH_SECRET/,
    );
  });

  it("rejects compose config when OSVA_AUTH_SECRET is unset", async () => {
    const env = await loadEnvironment();
    if (!env.docker?.version) {
      console.log("SKIP compose auth required test: Docker not found");
      return;
    }

    const composeCmd = env.docker.source ?? "docker";
    const envWithoutAuthSecret = {
      ...process.env,
      POSTGRES_PASSWORD: "compose-config-test-password",
    };
    delete envWithoutAuthSecret.OSVA_AUTH_SECRET;
    const result = spawnSync(
      composeCmd,
      ["compose", "-f", path.join(COMPOSE_DIR, "compose.yml"), "config"],
      {
        cwd: COMPOSE_DIR,
        encoding: "utf8",
        env: envWithoutAuthSecret,
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /OSVA_AUTH_SECRET is required/);
  });
});
