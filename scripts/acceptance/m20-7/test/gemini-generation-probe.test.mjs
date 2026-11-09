import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  estimateGeminiProbeWorstCaseMicroUsd,
  geminiGenerationProbeBaseEnv,
  geminiGenerationProbeExecuteBlockedReason,
  geminiGenerationProbeExecuteExitCode,
} from "../lib/gemini-generation-probe.mjs";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const probeScript = resolve(
  repoRoot,
  "scripts/acceptance/m20-7/gemini-builder-generation-probe.mjs",
);

describe("gemini-builder-generation-probe guards", () => {
  it("blocks execute without billable flags", () => {
    const env = geminiGenerationProbeBaseEnv({
      GOOGLE_GEMINI_API_KEY: "test-key",
      OSVA_M20_7_MAX_COST_USD_MICROS: "250000",
    });
    assert.equal(
      geminiGenerationProbeExecuteBlockedReason(env),
      "OSVA_M20_7_LIVE_EXECUTE not set",
    );
    assert.equal(
      estimateGeminiProbeWorstCaseMicroUsd(env).estimatedMicroUsd,
      13824,
    );
  });

  it("execute exit code is nonzero for provider HTTP errors", () => {
    assert.equal(
      geminiGenerationProbeExecuteExitCode("PROVIDER_HTTP_ERROR"),
      1,
    );
    assert.equal(
      geminiGenerationProbeExecuteExitCode("BUILDER_GENERATION_PASS"),
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
          assert.match(stdout, /gemini-generation-probe/);
          assert.match(stdout, /gemini-3.6-flash/);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });
});
