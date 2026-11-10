#!/usr/bin/env node
/**
 * M20.7.4 — isolate full Builder schema vs SDK via raw POST /v1/messages.
 *
 * Bypasses @anthropic-ai/sdk. Uses the production Builder prompt and flat
 * anthropic_records_v1 schema projection. Default: dry-run (zero provider I/O).
 *
 * Billable execute (one Messages HTTP call, no retries, no fallback):
 *   OSVA_M20_7_LIVE=1
 *   OSVA_M20_7_ISOLATED=1
 *   OSVA_M20_7_LIVE_EXECUTE=1
 *   OSVA_M20_7_ALLOW_BILLABLE=1
 *   OSVA_M20_7_MAX_COST_USD_MICROS=250000
 *   ANTHROPIC_API_KEY=...
 *   ANTHROPIC_WORKSPACE_ID=wrkspc_...   # optional; required for identity-linked keys
 *   pnpm acceptance:m20-7:anthropic-raw-messages -- --execute
 *
 * Operator-local HTTP 400 text (stderr only, after safety checks):
 *   OSVA_M20_7_ANTHROPIC_SHOW_PROVIDER_ERROR_TEXT=1
 *
 * Structured fingerprint (no raw message):
 *   OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS=1
 *
 * Mock provider (offline tests only):
 *   OSVA_M20_7_ANTHROPIC_RAW_MESSAGES_MOCK=1
 *
 * HTTP 200 does NOT prove Builder proposal acceptance.
 * Does not publish workflows or start execution.
 */
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { M20_7_DEFAULT_ANTHROPIC_MODEL } from "./lib/anthropic-model-lifecycle.mjs";
import {
  ANTHROPIC_RAW_MESSAGES_MOCK_ENV,
  ANTHROPIC_RAW_MESSAGES_MOCK_STATUS_ENV,
  M20_7_ANTHROPIC_TINY_STRUCTURED_OUTPUT_EVIDENCE,
  anthropicMessagesRequestUrl,
  anthropicRawMessagesBuilderInputs,
  anthropicRawMessagesProbeExecuteBlockedReason,
  anthropicRawMessagesProbeExitCode,
  assertAnthropicMessagesUrl,
  buildAnthropicRawMessagesHeaders,
  closeListeningHttpServer,
  createAnthropicRawFetchOnce,
  estimateAnthropicProbeWorstCaseMicroUsd,
  loadAnthropicRawMessagesProbeModules,
  readMockRequestPath,
  summarizeAnthropicCreateBody,
  summarizeAnthropicMessagesSuccess,
} from "./lib/anthropic-raw-messages-probe.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  let execute = false;
  let help = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--execute") {
      execute = true;
    } else if (arg === "--dry-run") {
      execute = false;
    }
  }
  return { execute, help };
}

function printHelp() {
  console.log(`M20.7.4 Anthropic raw Messages diagnostic (SDK bypass)

Uses POST /v1/messages with the flat anthropic_records_v1 schema.
Does not use @anthropic-ai/sdk. Default is dry-run.

Usage:
  pnpm acceptance:m20-7:anthropic-raw-messages
  pnpm acceptance:m20-7:anthropic-raw-messages -- --execute

Execute requires both billable gates:
  OSVA_M20_7_LIVE_EXECUTE=1
  OSVA_M20_7_ALLOW_BILLABLE=1
  ANTHROPIC_API_KEY
  OSVA_M20_7_MAX_COST_USD_MICROS

One invocation maximum. No retries. No workflow publication.

HTTP 200 records model/stop_reason/usage only — not Builder acceptance.
HTTP 400 classified codes go to stdout. Raw error.message is local-only after
OSVA_M20_7_ANTHROPIC_SHOW_PROVIDER_ERROR_TEXT=1 and safety checks.
`);
}

function failExit(code) {
  process.exitCode = code;
}

/**
 * @param {number} status
 * @returns {Promise<{ origin: string; requestCount: () => number; close(): Promise<void> }>}
 */
async function startMockMessagesServer(status) {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
    const path = readMockRequestPath(req);
    if (path !== "/v1/messages") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "wrong_path" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      void body;
      if (status === 200) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_mock_raw_full_schema",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5-5",
            stop_reason: "end_turn",
            content: [{ type: "text", text: '{"ok":true}' }],
            usage: { input_tokens: 12, output_tokens: 8 },
          }),
        );
        return;
      }

      res.writeHead(400, {
        "content-type": "application/json",
        "request-id": "req_mock_raw_messages",
      });
      res.end(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message:
              "output_config.format.schema: For 'string' type, property 'enum' is not supported",
          },
        }),
      );
    });
  });

  await new Promise((resolveListen, rejectListen) => {
    server.listen(0, "127.0.0.1", (error) => {
      if (error) {
        rejectListen(error);
        return;
      }
      resolveListen();
    });
  });

  const addr = server.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("mock bind failed");
  }

  return {
    origin: `http://127.0.0.1:${String(addr.port)}`,
    requestCount: () => requestCount,
    close: () => closeListeningHttpServer(server),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const EXECUTE = options.execute;
  const MOCK = process.env[ANTHROPIC_RAW_MESSAGES_MOCK_ENV] === "1";
  const mockStatusRaw = process.env[ANTHROPIC_RAW_MESSAGES_MOCK_STATUS_ENV];
  const mockStatus = mockStatusRaw === "200" ? 200 : 400;

  const modules = await loadAnthropicRawMessagesProbeModules();
  const model =
    process.env.OSVA_M20_7_GENERATION_MODEL?.trim() ??
    M20_7_DEFAULT_ANTHROPIC_MODEL;
  const maxOutputTokens = Number(
    process.env.OSVA_M20_7_MAX_OUTPUT_TOKENS ?? "2048",
  );

  const builderInputs = anthropicRawMessagesBuilderInputs();
  const messages = modules.buildBuilderGenerationMessages(
    builderInputs.catalogJson,
    builderInputs.userInstruction,
  );
  const body = modules.buildAnthropicMessagesCreateBody({
    model,
    messages,
    maxOutputTokens,
    jsonSchema: modules.BuilderProposalAnthropicRecordsJsonSchema,
  });
  const bodySummary = summarizeAnthropicCreateBody(body);

  const intendedBaseUrl = (
    process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"
  ).replace(/\/+$/, "");
  const intendedRequestUrl = anthropicMessagesRequestUrl(intendedBaseUrl);
  assertAnthropicMessagesUrl(intendedRequestUrl);

  const worstCaseCost = estimateAnthropicProbeWorstCaseMicroUsd({
    ...process.env,
    OSVA_M20_7_GENERATION_MODEL: model,
    OSVA_M20_7_MAX_INPUT_TOKENS:
      process.env.OSVA_M20_7_MAX_INPUT_TOKENS ?? "8192",
    OSVA_M20_7_MAX_OUTPUT_TOKENS: String(maxOutputTokens),
    OSVA_M20_7_MAX_COST_USD_MICROS:
      process.env.OSVA_M20_7_MAX_COST_USD_MICROS ?? "250000",
  });

  const dryRunSummary = {
    outcome: "PROBE_DRY_RUN",
    mode: EXECUTE ? "execute" : "dry_run",
    mockProvider: MOCK,
    transport: "raw_fetch",
    sdkBypassed: true,
    sdkMaxRetries: modules.ANTHROPIC_SDK_MAX_RETRIES,
    endpoint: modules.ANTHROPIC_MESSAGES_HTTP_PATH,
    requestUrlHost: new URL(intendedRequestUrl).host,
    model,
    max_tokens: body.max_tokens,
    anthropicVersion: modules.ANTHROPIC_MESSAGES_API_VERSION,
    sdkVersion: modules.sdkVersion,
    workspaceHeader:
      process.env.ANTHROPIC_WORKSPACE_ID?.trim().length > 0
        ? "present"
        : "absent",
    ...bodySummary,
    comparedToTinyStructuredOutput:
      M20_7_ANTHROPIC_TINY_STRUCTURED_OUTPUT_EVIDENCE,
    estimatedWorstCaseMicroUsd: worstCaseCost.estimatedMicroUsd ?? null,
    executeGates: ["OSVA_M20_7_LIVE_EXECUTE=1", "OSVA_M20_7_ALLOW_BILLABLE=1"],
    maxProviderInvocations: 1,
    retries: 0,
    notBuilderAcceptance:
      "raw Messages HTTP 200 does not prove Builder proposal validation",
  };

  console.log(JSON.stringify(dryRunSummary, null, 2));

  if (!EXECUTE) {
    console.log(
      "PROBE_DRY_RUN: set OSVA_M20_7_LIVE_EXECUTE=1 OSVA_M20_7_ALLOW_BILLABLE=1 and --execute for one raw Messages call.",
    );
    return;
  }

  const envForGate = MOCK
    ? {
        ...process.env,
        OSVA_M20_7_MAX_COST_USD_MICROS:
          process.env.OSVA_M20_7_MAX_COST_USD_MICROS ?? "250000",
        OSVA_M20_7_MAX_INPUT_TOKENS:
          process.env.OSVA_M20_7_MAX_INPUT_TOKENS ?? "8192",
        OSVA_M20_7_MAX_OUTPUT_TOKENS: String(maxOutputTokens),
      }
    : process.env;
  const blocked = anthropicRawMessagesProbeExecuteBlockedReason(envForGate, {
    mock: MOCK,
  });
  if (blocked !== undefined) {
    console.log(
      JSON.stringify({ outcome: "PROBE_BLOCKED", blockedReason: blocked }),
    );
    failExit(anthropicRawMessagesProbeExitCode("PROBE_BLOCKED"));
    return;
  }

  let mock;
  try {
    if (MOCK) {
      mock = await startMockMessagesServer(mockStatus);
    }
    const effectiveBaseUrl = mock !== undefined ? mock.origin : intendedBaseUrl;
    const requestUrl = anthropicMessagesRequestUrl(effectiveBaseUrl);
    assertAnthropicMessagesUrl(requestUrl);

    const apiKey = MOCK
      ? "mock-raw-messages-key"
      : process.env.ANTHROPIC_API_KEY.trim();
    const headers = buildAnthropicRawMessagesHeaders({
      apiKey,
      apiVersion: modules.ANTHROPIC_MESSAGES_API_VERSION,
      workspaceId: process.env.ANTHROPIC_WORKSPACE_ID,
    });

    const fetchOnce = createAnthropicRawFetchOnce(fetch);
    const response = await fetchOnce(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const rawText = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = undefined;
    }

    if (response.ok) {
      const success = summarizeAnthropicMessagesSuccess(parsed);
      console.log(
        JSON.stringify({
          outcome: "RAW_MESSAGES_HTTP_200",
          httpStatus: response.status,
          ...success,
          notBuilderAcceptance:
            "HTTP 200 means Anthropic accepted the flat records Builder IR request; it does not prove Builder proposal validation or product acceptance",
        }),
      );
      return;
    }

    const meta = modules.anthropicErrorMetadata({
      status: response.status,
      error: parsed,
      headers: response.headers,
      requestID: response.headers.get("request-id"),
    });

    if (process.env.OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS === "1") {
      process.stderr.write(
        `${modules.formatAnthropicOperatorHttpDiagnostic(meta)}\n`,
      );
    }

    let localErrorTextDisplayed = false;
    let localErrorTextBlockedReason;
    if (modules.isAnthropicProviderErrorTextDisplayEnabled(process.env)) {
      const display = modules.assessAnthropicParsedErrorForLocalDisplay({
        parsed,
        requestId: meta.providerRequestId,
      });
      if (display.ok) {
        process.stderr.write(
          modules.formatAnthropicProviderErrorLocalInspection({
            httpStatus: response.status,
            display,
          }),
        );
        localErrorTextDisplayed = true;
      } else {
        localErrorTextBlockedReason = display.reason;
        process.stderr.write(
          `ANTHROPIC_LOCAL_ERROR_INSPECTION_REFUSED: ${display.reason}\n`,
        );
      }
    }

    console.log(
      JSON.stringify({
        outcome: "PROVIDER_HTTP_ERROR",
        httpStatus: response.status,
        providerErrorType: meta.providerErrorType,
        providerErrorCode: meta.providerErrorCode,
        providerErrorParam: meta.providerErrorParam,
        providerRequestId: meta.providerRequestId,
        localErrorTextDisplayed,
        ...(localErrorTextBlockedReason !== undefined
          ? { localErrorTextBlockedReason }
          : {}),
        ...(meta.providerErrorReasonFingerprint !== undefined
          ? {
              providerErrorReasonFingerprint:
                meta.providerErrorReasonFingerprint,
              providerErrorReasonTokens: meta.providerErrorReasonTokens,
            }
          : {}),
        mockRequests:
          MOCK && mock !== undefined ? mock.requestCount() : undefined,
        notBuilderAcceptance: true,
      }),
    );
    failExit(anthropicRawMessagesProbeExitCode("PROVIDER_HTTP_ERROR"));
  } finally {
    if (mock !== undefined) {
      await mock.close();
    }
    void REPO_ROOT;
  }
}

main().catch((error) => {
  console.error("RAW_MESSAGES_PROBE_FAILED", error?.message ?? String(error));
  failExit(2);
});
