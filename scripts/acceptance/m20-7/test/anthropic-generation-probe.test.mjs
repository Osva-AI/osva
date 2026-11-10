import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  anthropicGenerationProbeBaseEnv,
  anthropicGenerationProbeExecuteBlockedReason,
  anthropicGenerationProbeExecuteExitCode,
  estimateAnthropicProbeWorstCaseMicroUsd,
} from "../lib/anthropic-generation-probe.mjs";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const probeScript = resolve(
  repoRoot,
  "scripts/acceptance/m20-7/anthropic-builder-generation-probe.mjs",
);

describe("anthropic-builder-generation-probe guards", () => {
  it("blocks execute without billable flags", () => {
    const env = anthropicGenerationProbeBaseEnv({
      ANTHROPIC_API_KEY: "test-key",
      OSVA_M20_7_MAX_COST_USD_MICROS: "500000",
    });
    assert.equal(
      anthropicGenerationProbeExecuteBlockedReason(env),
      "OSVA_M20_7_LIVE_EXECUTE not set",
    );
    assert.equal(
      estimateAnthropicProbeWorstCaseMicroUsd(env).estimatedMicroUsd,
      36864,
    );
  });

  it("execute exit code is nonzero for provider HTTP errors", () => {
    assert.equal(
      anthropicGenerationProbeExecuteExitCode("PROVIDER_HTTP_ERROR"),
      1,
    );
    assert.equal(
      anthropicGenerationProbeExecuteExitCode("BUILDER_GENERATION_PASS"),
      0,
    );
  });

  it("probe CLI documents entrypoint", () => {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [probeScript, "--help"], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        try {
          assert.equal(code, 0);
          assert.match(stdout, /anthropic-generation-probe/);
          assert.match(stdout, /claude-sonnet-5-5/);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });
});
