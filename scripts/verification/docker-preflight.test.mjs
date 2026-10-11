import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DOCKER_ENGINE_PROBE_ARGS,
  DOCKER_ENGINE_PROBE_TIMEOUT_MS,
  dockerReadinessFailures,
  probeDockerEngine,
} from "./docker-preflight.mjs";

const DOCKER_SPEC = { command: "docker", prefixArgs: [] };

describe("docker preflight", () => {
  it("fails when Docker CLI is missing", () => {
    const failures = dockerReadinessFailures({
      engine: "cli-unavailable",
    });
    assert.match(failures[0], /CLI is not available/);
  });

  it("fails when Docker engine is unavailable", () => {
    const failures = dockerReadinessFailures({
      version: "Docker version 27.0.0",
      compose: "Docker Compose version v2.29.0",
      engine: "engine-unavailable",
      engineHint: "Cannot connect to the Docker daemon",
    });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /engine is not running/);
    assert.match(failures[0], /Cannot connect/);
  });

  it("passes when Docker CLI, Compose, and engine are ready", () => {
    const failures = dockerReadinessFailures({
      version: "Docker version 27.0.0",
      compose: "Docker Compose version v2.29.0",
      engine: "engine-ready",
      engineHint: "Server Version: 27.0.0",
    });
    assert.deepEqual(failures, []);
  });

  it("probes engine readiness with docker info", async () => {
    /** @type {readonly (readonly string[])[]} */
    const calls = [];
    /** @type {unknown[]} */
    const probeOptions = [];
    const result = await probeDockerEngine(
      DOCKER_SPEC,
      async (_spec, args, options) => {
        calls.push(args);
        probeOptions.push(options);
        return {
          code: 0,
          stdout: "Server Version: 27.0.0\n",
          stderr: "",
        };
      },
    );
    assert.deepEqual(calls, [DOCKER_ENGINE_PROBE_ARGS]);
    assert.equal(probeOptions[0]?.timeoutMs, DOCKER_ENGINE_PROBE_TIMEOUT_MS);
    assert.equal(result.engine, "engine-ready");
    assert.match(result.engineHint ?? "", /Server Version/);
  });

  it("classifies docker info failure as engine unavailable", async () => {
    const result = await probeDockerEngine(DOCKER_SPEC, async () => ({
      code: 1,
      stdout: "",
      stderr:
        "error during connect: open //./pipe/docker_engine: The system cannot find the file specified.",
    }));
    assert.equal(result.engine, "engine-unavailable");
    assert.match(result.engineHint ?? "", /docker_engine/);
  });
});
