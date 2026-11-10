import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  ANTHROPIC_RAW_MESSAGES_MOCK_ENV,
  ANTHROPIC_RAW_MESSAGES_MOCK_STATUS_ENV,
  anthropicMessagesRequestUrl,
  anthropicRawMessagesProbeExecuteBlockedReason,
  anthropicRawMessagesProbeExitCode,
  assertAnthropicMessagesUrl,
  createAnthropicRawFetchOnce,
  summarizeAnthropicCreateBody,
  summarizeAnthropicMessagesSuccess,
} from "../lib/anthropic-raw-messages-probe.mjs";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const probeScript = resolve(
  repoRoot,
  "scripts/acceptance/m20-7/anthropic-builder-raw-messages-probe.mjs",
);

const CI_MARKERS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "TF_BUILD",
  "BUILDKITE",
];

function spawnProbe(args, extraEnv) {
  const env = { ...process.env, ...extraEnv };
  for (const key of CI_MARKERS) {
    delete env[key];
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [probeScript, ...args], {
      cwd: repoRoot,
      env,
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
    child.on("close", (code, signal) => {
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

describe("anthropic raw Messages probe", () => {
  it("rejects count_tokens URL and requires both billable gates", () => {
    assert.throws(
      () =>
        assertAnthropicMessagesUrl(
          "https://api.anthropic.com/v1/messages/count_tokens",
        ),
      /\/v1\/messages/,
    );
    assert.equal(
      anthropicMessagesRequestUrl("https://api.anthropic.com"),
      "https://api.anthropic.com/v1/messages",
    );
    assert.equal(
      anthropicRawMessagesProbeExecuteBlockedReason({
        OSVA_M20_7_ALLOW_BILLABLE: "1",
      }),
      "OSVA_M20_7_LIVE_EXECUTE not set",
    );
    assert.equal(
      anthropicRawMessagesProbeExecuteBlockedReason({
        OSVA_M20_7_LIVE_EXECUTE: "1",
      }),
      "OSVA_M20_7_ALLOW_BILLABLE not set",
    );
    assert.equal(anthropicRawMessagesProbeExitCode("PROVIDER_HTTP_ERROR"), 1);
    assert.equal(anthropicRawMessagesProbeExitCode("RAW_MESSAGES_HTTP_200"), 0);
  });

  it("refuses a second fetch and omits credentials from body summary", async () => {
    const fetchOnce = createAnthropicRawFetchOnce(async () => ({ ok: true }));
    await fetchOnce("https://api.anthropic.com/v1/messages", {
      method: "POST",
    });
    await assert.rejects(
      () =>
        fetchOnce("https://api.anthropic.com/v1/messages", { method: "POST" }),
      /more than one provider invocation/,
    );

    const summary = summarizeAnthropicCreateBody({
      model: "claude-sonnet-5-5",
      max_tokens: 2048,
      system: "builder proposal generator",
      messages: [
        { role: "user", content: "catalog" },
        { role: "user", content: "instruction" },
      ],
      output_config: {
        format: { type: "json_schema", schema: { type: "object" } },
      },
    });
    assert.equal(summary.hasOutputConfig, true);
    assert.equal(summary.containsApiKey, false);
    assert.deepEqual(summary.omittedSamplingKeys, [
      "temperature",
      "top_p",
      "top_k",
      "output_format",
    ]);

    const success = summarizeAnthropicMessagesSuccess({
      model: "claude-sonnet-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"ok":true}' }],
      usage: { input_tokens: 12, output_tokens: 8 },
    });
    assert.equal(success.responseStructureValid, true);
    assert.equal(success.outputJsonValid, true);
    assert.equal(success.stop_reason, "end_turn");
  });

  it("execute without billable flags is blocked", async () => {
    const result = await spawnProbe(["--execute"], {
      OSVA_M20_7_MAX_COST_USD_MICROS: "250000",
      OSVA_M20_7_MAX_INPUT_TOKENS: "8192",
      OSVA_M20_7_MAX_OUTPUT_TOKENS: "2048",
    });
    assert.equal(result.code, 2);
    assert.match(result.stdout, /PROBE_BLOCKED/);
    assert.match(result.stdout, /LIVE_EXECUTE/);
  });

  it("dry-run CLI documents raw Messages entrypoint without provider I/O", async () => {
    const help = await spawnProbe(["--help"], {});
    assert.equal(help.code, 0);
    assert.match(help.stdout, /raw Messages diagnostic/);
    assert.match(help.stdout, /does not use @anthropic-ai\/sdk/i);
    assert.match(help.stdout, /HTTP 200 records/);

    const dryRun = await spawnProbe([], {});
    assert.equal(dryRun.code, 0);
    assert.match(dryRun.stdout, /PROBE_DRY_RUN/);
    assert.match(dryRun.stdout, /"sdkBypassed": true/);
    assert.match(dryRun.stdout, /claude-sonnet-5-5/);
    assert.match(dryRun.stdout, /2026-10-21/);
    assert.doesNotMatch(dryRun.stdout, /USER_INSTRUCTION/);
  });

  it("mocked execute hits /v1/messages once, classifies 400, and keeps raw text off stdout", async () => {
    const result = await spawnProbe(["--execute"], {
      [ANTHROPIC_RAW_MESSAGES_MOCK_ENV]: "1",
      OSVA_M20_7_LIVE_EXECUTE: "1",
      OSVA_M20_7_ALLOW_BILLABLE: "1",
      OSVA_M20_7_MAX_COST_USD_MICROS: "250000",
      OSVA_M20_7_MAX_INPUT_TOKENS: "8192",
      OSVA_M20_7_MAX_OUTPUT_TOKENS: "2048",
      OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS: "1",
      OSVA_M20_7_ANTHROPIC_SHOW_PROVIDER_ERROR_TEXT: "1",
      ANTHROPIC_WORKSPACE_ID: "wrkspc_01MockRawWorkspace",
    });

    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.notEqual(result.code, -1073740791);
    assert.doesNotMatch(result.stderr, /UV_HANDLE_CLOSING/);
    assert.match(result.stdout, /PROVIDER_HTTP_ERROR/);
    assert.match(result.stdout, /unsupported_schema_feature/);
    assert.match(result.stdout, /"mockRequests":\s*1/);
    assert.match(result.stdout, /raw_fetch/);
    assert.match(result.stdout, /sdkBypassed/);
    assert.doesNotMatch(result.stdout, /mock-raw-messages-key/);
    assert.doesNotMatch(result.stdout, /property 'enum' is not supported/);
    assert.doesNotMatch(result.stdout, /USER_INSTRUCTION/);
    assert.match(result.stderr, /anthropic_operator_http_diagnostic/);
    assert.match(result.stderr, /ANTHROPIC_LOCAL_ERROR_INSPECTION/);
    assert.match(result.stderr, /invalid_request_error/);
    assert.doesNotMatch(result.stderr, /mock-raw-messages-key/);
  });

  it("mocked HTTP 200 records usage without claiming Builder acceptance", async () => {
    const result = await spawnProbe(["--execute"], {
      [ANTHROPIC_RAW_MESSAGES_MOCK_ENV]: "1",
      [ANTHROPIC_RAW_MESSAGES_MOCK_STATUS_ENV]: "200",
      OSVA_M20_7_LIVE_EXECUTE: "1",
      OSVA_M20_7_ALLOW_BILLABLE: "1",
      OSVA_M20_7_MAX_COST_USD_MICROS: "250000",
      OSVA_M20_7_MAX_INPUT_TOKENS: "8192",
      OSVA_M20_7_MAX_OUTPUT_TOKENS: "2048",
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /RAW_MESSAGES_HTTP_200/);
    assert.match(result.stdout, /end_turn/);
    assert.match(result.stdout, /does not prove Builder proposal validation/);
    assert.doesNotMatch(result.stdout, /BUILDER_GENERATION_PASS/);
    assert.doesNotMatch(result.stdout, /mock-raw-messages-key/);
  });
});
