import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DOCKER_ENGINE_READY_STATE,
  isDockerEngineReady,
} from "./docker-preflight.mjs";
import {
  dockerAvailable,
  planObligationExecution,
} from "./branch-verify-docker.mjs";

describe("branch verify docker preflight", () => {
  it("treats engine-ready as available for Docker obligations", () => {
    assert.equal(
      isDockerEngineReady({ engine: DOCKER_ENGINE_READY_STATE }),
      true,
    );
    assert.equal(isDockerEngineReady({ engine: "engine-unavailable" }), false);
    assert.equal(isDockerEngineReady(undefined), false);
  });

  it("dockerAvailable returns true when probe reports engine-ready", async () => {
    const ok = await dockerAvailable(
      { docker: { source: "docker" } },
      async () => ({
        code: 0,
        stdout: "Server Version: 27.0.0\n",
        stderr: "",
      }),
    );
    assert.equal(ok, true);
  });

  it("dockerAvailable returns false when probe reports engine-unavailable", async () => {
    const ok = await dockerAvailable(
      { docker: { source: "docker" } },
      async () => ({
        code: 1,
        stdout: "",
        stderr: "Cannot connect to the Docker daemon",
      }),
    );
    assert.equal(ok, false);
  });

  it("dockerAvailable returns false when docker CLI source is missing", async () => {
    const ok = await dockerAvailable({ docker: undefined }, async () => {
      throw new Error("probe should not run");
    });
    assert.equal(ok, false);
  });

  it("integration profile runs eligible obligations when docker is ready", () => {
    const obligation = {
      id: "knowledge-memory-integration",
      label: "Knowledge/memory integration",
      command: "pnpm test:integration",
      commandArgv: ["pnpm", "test:integration"],
      reason: "Deferred in fast profile.",
      requiresDocker: true,
      runInIntegrationProfile: true,
    };
    assert.deepEqual(planObligationExecution(obligation, "integration", true), {
      action: "run",
    });
  });

  it("integration profile skips docker obligations when engine is unavailable", () => {
    const obligation = {
      id: "knowledge-memory-integration",
      label: "Knowledge/memory integration",
      command: "pnpm test:integration",
      commandArgv: ["pnpm", "test:integration"],
      reason: "Deferred in fast profile.",
      requiresDocker: true,
      runInIntegrationProfile: true,
    };
    const planned = planObligationExecution(obligation, "integration", false);
    assert.equal(planned.action, "skip-docker");
    assert.match(planned.detail ?? "", /Docker engine unavailable/i);
  });

  it("fast profile defers integration obligations with the configured reason", () => {
    const obligation = {
      id: "m16-3-onboarding-browser",
      label: "M16.3 first-agent onboarding browser acceptance",
      command: "vitest browser",
      commandArgv: ["pnpm", "exec", "vitest"],
      reason: "Run with --profile=integration when Docker is available.",
      requiresDocker: true,
      runInIntegrationProfile: true,
    };
    const planned = planObligationExecution(obligation, "fast", true);
    assert.equal(planned.action, "defer");
    assert.equal(
      planned.detail,
      "Run with --profile=integration when Docker is available.",
    );
  });
});
