import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  ANTHROPIC_COUNT_TOKENS_EXECUTE_ENV,
  ANTHROPIC_COUNT_TOKENS_MOCK_ENV,
  anthropicCountTokensExecuteBlockedReason,
  anthropicCountTokensProbeExitCode,
  anthropicCountTokensRequestUrl,
  assertAnthropicCountTokensUrl,
} from "../lib/anthropic-count-tokens-probe.mjs";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const probeScript = resolve(
  repoRoot,
  "scripts/acceptance/m20-7/anthropic-builder-count-tokens-probe.mjs",
);

describe("anthropic count_tokens probe", () => {
  it("rejects generation URL", () => {
    assert.throws(
      () =>
        assertAnthropicCountTokensUrl("https://api.anthropic.com/v1/messages"),
      /count_tokens/,
    );
    assert.equal(
      anthropicCountTokensRequestUrl("https://api.anthropic.com"),
      "https://api.anthropic.com/v1/messages/count_tokens",
    );
  });

  it("blocks execute without env gate", () => {
    assert.equal(
      anthropicCountTokensExecuteBlockedReason({ ANTHROPIC_API_KEY: "k" }),
      `${ANTHROPIC_COUNT_TOKENS_EXECUTE_ENV} not set`,
    );
    assert.equal(anthropicCountTokensProbeExitCode("COUNT_TOKENS_OK"), 0);
    assert.equal(anthropicCountTokensProbeExitCode("PROVIDER_HTTP_ERROR"), 1);
  });

  it("mocked execute hits count_tokens only and classifies 400 without secrets", () => {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [probeScript, "--execute"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          [ANTHROPIC_COUNT_TOKENS_MOCK_ENV]: "1",
          [ANTHROPIC_COUNT_TOKENS_EXECUTE_ENV]: "1",
          OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        try {
          assert.equal(code, 1);
          assert.match(stdout, /PROVIDER_HTTP_ERROR/);
          assert.match(stdout, /unsupported_schema_feature/);
          assert.doesNotMatch(stdout, /mock-count-key/);
          assert.doesNotMatch(stdout, /pattern' is not supported/);
          assert.match(stderr, /anthropic_operator_http_diagnostic/);
          assert.doesNotMatch(stderr, /pattern' is not supported/);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });

  it("dry-run CLI documents count_tokens entrypoint", () => {
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
          assert.match(stdout, /count_tokens/);
          assert.match(stdout, /does NOT validate structured-output/);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });
});
