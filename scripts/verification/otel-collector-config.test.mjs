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
const COLLECTOR_IMAGE = "otel/opentelemetry-collector-contrib:0.128.0";
const COLLECTOR_CONFIG = path.join(
  REPO_ROOT,
  "deploy",
  "observability",
  "collector",
  "otel-collector.yaml",
);

describe("otel collector configuration", () => {
  it("validates the shipped collector config", async () => {
    const env = await loadEnvironment();
    if (!env.docker?.version) {
      console.log("SKIP collector validate: Docker not found");
      return;
    }

    const result = spawnSync(
      env.docker.source ?? "docker",
      [
        "run",
        "--rm",
        "--entrypoint",
        "/otelcol-contrib",
        "-v",
        `${COLLECTOR_CONFIG}:/etc/otelcol-contrib/config.yaml:ro`,
        COLLECTOR_IMAGE,
        "validate",
        "--config=/etc/otelcol-contrib/config.yaml",
      ],
      { encoding: "utf8" },
    );
    assert.equal(
      result.status,
      0,
      result.stderr || result.stdout || "collector validate failed",
    );
  });
});
