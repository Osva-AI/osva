import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  anthropicRefinementProbeBaseEnv,
  anthropicRefinementProbeExecuteBlockedReason,
  anthropicRefinementProbeExecuteExitCode,
  estimateAnthropicRefinementProbeWorstCaseMicroUsd,
} from "../lib/anthropic-refinement-probe.mjs";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const probeScript = resolve(
  repoRoot,
  "scripts/acceptance/m20-7/anthropic-builder-refinement-probe.mjs",
);

describe("anthropic-builder-refinement-probe guards", () => {
  it("blocks execute without billable flags", () => {
    const env = anthropicRefinementProbeBaseEnv({
      ANTHROPIC_API_KEY: "test-key",
      OSVA_M20_7_MAX_COST_USD_MICROS: "500000",
    });
    assert.equal(
      anthropicRefinementProbeExecuteBlockedReason(env),
      "OSVA_M20_7_LIVE_EXECUTE not set",
    );
    assert.equal(
      estimateAnthropicRefinementProbeWorstCaseMicroUsd(env).estimatedMicroUsd,
      36864,
    );
  });

  it("execute exit code is nonzero unless refinement passed", () => {
    assert.equal(
      anthropicRefinementProbeExecuteExitCode("PROVIDER_HTTP_ERROR"),
      1,
    );
    assert.equal(
      anthropicRefinementProbeExecuteExitCode("BUILDER_REFINEMENT_FAIL"),
      1,
    );
    assert.equal(
      anthropicRefinementProbeExecuteExitCode("BUILDER_REFINEMENT_PASS"),
      0,
    );
  });

  it("probe CLI documents fixture baseline and one refine call", () => {
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
          assert.match(stdout, /anthropic-refinement-probe/);
          assert.match(stdout, /claude-sonnet-5-5/);
          assert.match(stdout, /canonical one-agent fixture/);
          assert.match(stdout, /APPROVAL/);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });
});
