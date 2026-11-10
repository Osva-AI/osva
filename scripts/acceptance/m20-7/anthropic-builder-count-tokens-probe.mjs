#!/usr/bin/env node
/**
 * M20.7.4 — Anthropic Builder count_tokens diagnostic (operator-controlled, non-billable generation).
 *
 * Uses POST /v1/messages/count_tokens only — never POST /v1/messages.
 *
 * Default: dry-run (prints contract summary, zero provider I/O).
 *
 * Execute (token count HTTP only — not Builder acceptance):
 *   OSVA_M20_7_ANTHROPIC_COUNT_TOKENS_EXECUTE=1
 *   ANTHROPIC_API_KEY=...
 *   ANTHROPIC_WORKSPACE_ID=wrkspc_...   # optional; required for identity-linked keys
 *   pnpm acceptance:m20-7:anthropic-count-tokens -- --execute
 *
 * Opt-in operator HTTP 400 inspection (stderr, structured — no raw message in stdout artifact):
 *   OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS=1
 *
 * Mock provider (offline):
 *   OSVA_M20_7_ANTHROPIC_COUNT_TOKENS_MOCK=1
 *   OSVA_M20_7_ANTHROPIC_COUNT_TOKENS_EXECUTE=1
 *   node scripts/acceptance/m20-7/anthropic-builder-count-tokens-probe.mjs
 */
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { M20_7_DEFAULT_ANTHROPIC_MODEL } from "./lib/anthropic-model-lifecycle.mjs";
import {
  ANTHROPIC_COUNT_TOKENS_EXECUTE_ENV,
  ANTHROPIC_COUNT_TOKENS_MOCK_ENV,
  M20_7_ANTHROPIC_COUNT_TOKENS_CATALOG_JSON,
  M20_7_ANTHROPIC_PROBE_SMOKE_INSTRUCTION,
  anthropicCountTokensExecuteBlockedReason,
  anthropicCountTokensProbeExitCode,
  anthropicCountTokensRequestUrl,
  assertAnthropicCountTokensUrl,
  buildAnthropicCountTokensHeaders,
  loadAnthropicCountTokensProbeModules,
  readCountTokensInputTokens,
  readMockRequestPath,
} from "./lib/anthropic-count-tokens-probe.mjs";
import { closeListeningHttpServer } from "./lib/anthropic-raw-messages-probe.mjs";

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
  console.log(`M20.7.4 Anthropic builder count_tokens diagnostic

Uses POST /v1/messages/count_tokens only (no generation).

Usage:
  pnpm acceptance:m20-7:anthropic-count-tokens
  pnpm acceptance:m20-7:anthropic-count-tokens -- --execute

Execute requires:
  ${ANTHROPIC_COUNT_TOKENS_EXECUTE_ENV}=1
  ANTHROPIC_API_KEY

Success reports input_tokens only. It does NOT validate structured-output grammar compilation.
`);
}

function failExit(code) {
  process.exitCode = code;
}

/**
 * @returns {Promise<{ origin: string; close(): Promise<void> }>}
 */
async function startMockCountTokensServer() {
  const server = http.createServer((req, res) => {
    const path = readMockRequestPath(req);
    if (path !== "/v1/messages/count_tokens") {
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
      res.writeHead(400, {
        "content-type": "application/json",
        "request-id": "req_mock_count_tokens",
      });
      res.end(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message:
              "output_config.format.schema: For 'string' type, property 'pattern' is not supported",
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
  const MOCK = process.env[ANTHROPIC_COUNT_TOKENS_MOCK_ENV] === "1";

  const modules = await loadAnthropicCountTokensProbeModules();
  const model =
    process.env.OSVA_M20_7_PROBE_MODEL?.trim() ?? M20_7_DEFAULT_ANTHROPIC_MODEL;

  const messages = modules.buildBuilderGenerationMessages(
    M20_7_ANTHROPIC_COUNT_TOKENS_CATALOG_JSON,
    M20_7_ANTHROPIC_PROBE_SMOKE_INSTRUCTION,
  );

  const body = modules.buildAnthropicMessagesCountTokensBody({
    model,
    messages,
    jsonSchema: modules.BuilderProposalAnthropicRecordsJsonSchema,
  });

  const baseUrl = (
    process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"
  ).replace(/\/+$/, "");

  let mock;
  let effectiveBaseUrl = baseUrl;
  if (MOCK) {
    mock = await startMockCountTokensServer();
    effectiveBaseUrl = mock.origin;
  }

  try {
    const requestUrl = anthropicCountTokensRequestUrl(effectiveBaseUrl);
    assertAnthropicCountTokensUrl(requestUrl);

    const dryRunSummary = {
      outcome: "PROBE_DRY_RUN",
      mode: EXECUTE ? "execute" : "dry_run",
      mockProvider: MOCK,
      endpoint: modules.ANTHROPIC_COUNT_TOKENS_HTTP_PATH,
      requestUrlHost: new URL(requestUrl).host,
      model,
      anthropicVersion: modules.ANTHROPIC_MESSAGES_API_VERSION,
      sdkVersion: modules.sdkVersion,
      bodyFieldKeys: Object.keys(body).sort(),
      bodyBytes: JSON.stringify(body).length,
      hasOutputConfig: body.output_config !== undefined,
      workspaceHeader:
        process.env.ANTHROPIC_WORKSPACE_ID?.trim().length > 0
          ? "present"
          : "absent",
      executeEnv: `${ANTHROPIC_COUNT_TOKENS_EXECUTE_ENV}=1`,
      notBuilderAcceptance:
        "count_tokens success does not prove structured-output grammar compilation",
    };

    console.log(JSON.stringify(dryRunSummary, null, 2));

    if (!EXECUTE) {
      console.log(
        `PROBE_DRY_RUN: set ${ANTHROPIC_COUNT_TOKENS_EXECUTE_ENV}=1 and --execute for count_tokens only.`,
      );
      return;
    }

    const envForGate = MOCK
      ? { ...process.env, ANTHROPIC_API_KEY: "mock-count-key" }
      : process.env;
    const blocked = anthropicCountTokensExecuteBlockedReason(envForGate);
    if (blocked !== undefined) {
      console.log(
        JSON.stringify({ outcome: "PROBE_BLOCKED", blockedReason: blocked }),
      );
      failExit(anthropicCountTokensProbeExitCode("PROBE_BLOCKED"));
      return;
    }

    const apiKey = MOCK
      ? "mock-count-key"
      : process.env.ANTHROPIC_API_KEY.trim();
    const headers = buildAnthropicCountTokensHeaders({
      apiKey,
      apiVersion: modules.ANTHROPIC_MESSAGES_API_VERSION,
      workspaceId: process.env.ANTHROPIC_WORKSPACE_ID,
    });

    const response = await fetch(requestUrl, {
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
      const inputTokens = readCountTokensInputTokens(parsed);
      console.log(
        JSON.stringify({
          outcome: "COUNT_TOKENS_OK",
          httpStatus: response.status,
          input_tokens: inputTokens,
          disclaimer:
            "input_tokens only; does not prove Builder structured-output acceptance",
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

    console.log(
      JSON.stringify({
        outcome: "PROVIDER_HTTP_ERROR",
        httpStatus: response.status,
        providerErrorType: meta.providerErrorType,
        providerErrorCode: meta.providerErrorCode,
        providerErrorParam: meta.providerErrorParam,
        providerRequestId: meta.providerRequestId,
        ...(meta.providerErrorReasonFingerprint !== undefined
          ? {
              providerErrorReasonFingerprint:
                meta.providerErrorReasonFingerprint,
              providerErrorReasonTokens: meta.providerErrorReasonTokens,
            }
          : {}),
        notBuilderAcceptance: true,
      }),
    );
    failExit(anthropicCountTokensProbeExitCode("PROVIDER_HTTP_ERROR"));
  } finally {
    if (mock !== undefined) {
      await mock.close();
    }
    void REPO_ROOT;
  }
}

main().catch((error) => {
  console.error("COUNT_TOKENS_PROBE_FAILED", error?.message ?? String(error));
  failExit(2);
});
