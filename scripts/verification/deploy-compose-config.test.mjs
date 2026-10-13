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
    assert.match(result.stdout, /OSVA_HEALTH_PORT: "8081"/);
    assert.doesNotMatch(result.stdout, /console:/);
    assert.doesNotMatch(result.stdout, /OSVA_PROCESS: console/);
    assert.doesNotMatch(result.stdout, /otel-collector/);
    assert.doesNotMatch(result.stdout, /OTEL_EXPORTER_OTLP_ENDPOINT/);
  });

  it("keeps default Compose free of observability endpoints", async () => {
    const env = await loadEnvironment();
    if (!env.docker?.version) {
      console.log("SKIP compose default observability test: Docker not found");
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
    assert.doesNotMatch(result.stdout, /published: ["']?4318/);
    assert.doesNotMatch(result.stdout, /published: ["']?8889/);
  });

  it("opt-in overlay starts the collector and points application services at it", async () => {
    const env = await loadEnvironment();
    if (!env.docker?.version) {
      console.log("SKIP compose observability overlay test: Docker not found");
      return;
    }

    const composeCmd = env.docker.source ?? "docker";
    const result = spawnSync(
      composeCmd,
      [
        "compose",
        "-f",
        path.join(COMPOSE_DIR, "compose.yml"),
        "-f",
        path.join(COMPOSE_DIR, "compose.observability.yml"),
        "config",
      ],
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
    assert.match(result.stdout, /otel-collector/);
    assert.match(
      result.stdout,
      /OTEL_EXPORTER_OTLP_ENDPOINT: http:\/\/otel-collector:4318/,
    );
    assert.match(result.stdout, /OTEL_SERVICE_NAME: osva-web/);
    assert.match(result.stdout, /OTEL_SERVICE_NAME: osva-worker/);
    assert.match(result.stdout, /OTEL_SERVICE_NAME: osva-scheduler/);
    assert.match(
      result.stdout,
      /OTEL_SERVICE_NAME: osva-workflow-orchestrator/,
    );
    assert.match(result.stdout, /OTEL_SERVICE_NAME: osva-knowledge-worker/);
    assert.match(result.stdout, /OTEL_SERVICE_NAME: osva-mcp/);
    assert.doesNotMatch(result.stdout, /published: ["']?4318/);
    assert.doesNotMatch(result.stdout, /published: ["']?4317/);
    assert.doesNotMatch(result.stdout, /published: ["']?8889/);
    assert.match(result.stdout, /127\.0\.0\.1/);
  });

  it("renders optional Valkey AUTH without changing the default no-auth topology", async () => {
    const env = await loadEnvironment();
    if (!env.docker?.version) {
      console.log("SKIP compose valkey auth test: Docker not found");
      return;
    }

    const composeCmd = env.docker.source ?? "docker";
    const unauthenticated = spawnSync(
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
    assert.equal(
      unauthenticated.status,
      0,
      unauthenticated.stderr || unauthenticated.stdout,
    );
    assert.match(
      unauthenticated.stdout,
      /OSVA_VALKEY_URL: redis:\/\/valkey:6379/,
    );

    const authenticated = spawnSync(
      composeCmd,
      ["compose", "-f", path.join(COMPOSE_DIR, "compose.yml"), "config"],
      {
        cwd: COMPOSE_DIR,
        encoding: "utf8",
        env: {
          ...process.env,
          POSTGRES_PASSWORD: "compose-config-test-password",
          VALKEY_PASSWORD: "compose-valkey-secret",
          OSVA_VALKEY_URL: "redis://:compose-valkey-secret@valkey:6379",
        },
      },
    );
    assert.equal(
      authenticated.status,
      0,
      authenticated.stderr || authenticated.stdout,
    );
    assert.match(authenticated.stdout, /requirepass/);
    assert.match(
      authenticated.stdout,
      /OSVA_VALKEY_URL: redis:\/\/:compose-valkey-secret@valkey:6379/,
    );
  });
});
