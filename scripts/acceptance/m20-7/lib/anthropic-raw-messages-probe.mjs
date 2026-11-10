/**
 * M20.7.4 — Anthropic raw POST /v1/messages diagnostic (bypasses @anthropic-ai/sdk).
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  M20_7_ANTHROPIC_COUNT_TOKENS_CATALOG_JSON,
  M20_7_ANTHROPIC_PROBE_SMOKE_INSTRUCTION,
} from "./anthropic-count-tokens-probe.mjs";
import {
  anthropicProbeWorstCaseCostBlockedReason,
  estimateAnthropicProbeWorstCaseMicroUsd,
} from "./anthropic-generation-probe.mjs";
import { liveExecuteBlockedReason } from "./live-guards.mjs";
import { M20_7_DEFAULT_ANTHROPIC_MODEL } from "./anthropic-model-lifecycle.mjs";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export const ANTHROPIC_RAW_MESSAGES_MOCK_ENV =
  "OSVA_M20_7_ANTHROPIC_RAW_MESSAGES_MOCK";
export const ANTHROPIC_RAW_MESSAGES_MOCK_STATUS_ENV =
  "OSVA_M20_7_ANTHROPIC_RAW_MESSAGES_MOCK_STATUS";

export const M20_7_ANTHROPIC_TINY_STRUCTURED_OUTPUT_EVIDENCE = Object.freeze({
  transport: "direct_messages_api",
  model: "claude-sonnet-5-5",
  apiVersion: "2026-10-21",
  workspaceHeader: "present",
  structuredOutput: "output_config.format",
  httpStatus: 200,
  stopReason: "end_turn",
  outputShape: "tiny_json_ok_true",
  inputTokens: 204,
  outputTokens: 9,
});

/**
 * @param {string} url
 */
export function assertAnthropicMessagesUrl(url) {
  const { pathname } = new URL(url);
  if (pathname !== "/v1/messages") {
    throw new Error(`refused: pathname must be /v1/messages (got ${pathname})`);
  }
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
export function anthropicMessagesRequestUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, "");
  const url = `${normalized}/v1/messages`;
  assertAnthropicMessagesUrl(url);
  return url;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ mock?: boolean }} [options]
 * @returns {string | undefined}
 */
export function anthropicRawMessagesProbeExecuteBlockedReason(
  env,
  options = {},
) {
  if (env.OSVA_M20_7_LIVE_EXECUTE !== "1") {
    return "OSVA_M20_7_LIVE_EXECUTE not set";
  }
  if (env.OSVA_M20_7_ALLOW_BILLABLE !== "1") {
    return "OSVA_M20_7_ALLOW_BILLABLE not set";
  }

  const requested =
    env.OSVA_M20_7_GENERATION_MODEL?.trim() ?? M20_7_DEFAULT_ANTHROPIC_MODEL;
  if (requested !== M20_7_DEFAULT_ANTHROPIC_MODEL) {
    return `PROBE_MODEL_MISMATCH:expected ${M20_7_DEFAULT_ANTHROPIC_MODEL}`;
  }

  const mock =
    options.mock === true || env[ANTHROPIC_RAW_MESSAGES_MOCK_ENV] === "1";
  if (!mock) {
    const live = liveExecuteBlockedReason(env, { provider: "anthropic" });
    if (live !== undefined) {
      return live;
    }
  }

  return anthropicProbeWorstCaseCostBlockedReason(env);
}

/**
 * @param {string} outcome
 * @returns {number}
 */
export function anthropicRawMessagesProbeExitCode(outcome) {
  if (outcome === "PROBE_DRY_RUN") {
    return 0;
  }
  if (outcome === "RAW_MESSAGES_HTTP_200") {
    return 0;
  }
  if (outcome === "PROBE_BLOCKED") {
    return 2;
  }
  return 1;
}

/**
 * @param {Record<string, string | undefined>} headers
 * @returns {Record<string, string>}
 */
export function buildAnthropicRawMessagesHeaders(headers) {
  const out = {
    "content-type": "application/json",
    connection: "close",
    "x-api-key": headers.apiKey ?? "",
    "anthropic-version": headers.apiVersion ?? "2026-10-21",
  };
  const workspaceId = headers.workspaceId?.trim();
  if (workspaceId !== undefined && workspaceId.length > 0) {
    out["anthropic-workspace-id"] = workspaceId;
  }
  return out;
}

/**
 * @param {typeof fetch} [fetchImpl]
 */
export function createAnthropicRawFetchOnce(fetchImpl = fetch) {
  let count = 0;
  return async function fetchOnce(url, init) {
    count += 1;
    if (count > 1) {
      throw new Error("refused: more than one provider invocation");
    }
    return fetchImpl(url, init);
  };
}

/**
 * @param {Record<string, unknown>} body
 */
export function summarizeAnthropicCreateBody(body) {
  const outputConfig = body.output_config;
  const schema =
    outputConfig !== null &&
    typeof outputConfig === "object" &&
    "format" in outputConfig &&
    outputConfig.format !== null &&
    typeof outputConfig.format === "object" &&
    "schema" in outputConfig.format
      ? outputConfig.format.schema
      : undefined;
  const schemaJson = schema === undefined ? "" : JSON.stringify(schema);
  const bodyJson = JSON.stringify(body);
  const omittedSamplingKeys = [
    "temperature",
    "top_p",
    "top_k",
    "output_format",
  ];
  return {
    model: body.model,
    max_tokens: body.max_tokens,
    bodyFieldKeys: Object.keys(body).sort(),
    bodyBytes: bodyJson.length,
    schemaBytes: schemaJson.length,
    hasOutputConfig: outputConfig !== undefined,
    hasSystem: typeof body.system === "string" && body.system.length > 0,
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    omittedSamplingKeys,
    containsPatternKeyword: schemaJson.includes('"pattern"'),
    containsApiKey: bodyJson.includes("sk-"),
  };
}

/**
 * @param {unknown} parsed
 */
export function summarizeAnthropicMessagesSuccess(parsed) {
  if (parsed === null || typeof parsed !== "object") {
    return { responseStructureValid: false };
  }
  const record = /** @type {Record<string, unknown>} */ (parsed);
  const usage =
    record.usage !== null && typeof record.usage === "object"
      ? /** @type {Record<string, unknown>} */ (record.usage)
      : {};
  const content = Array.isArray(record.content) ? record.content : [];
  const text = content
    .filter(
      (block) =>
        block !== null &&
        typeof block === "object" &&
        /** @type {Record<string, unknown>} */ (block).type === "text",
    )
    .map((block) => {
      const textValue = /** @type {Record<string, unknown>} */ (block).text;
      return typeof textValue === "string" ? textValue : "";
    })
    .join("");
  let outputJsonValid = false;
  if (text.length > 0) {
    try {
      JSON.parse(text);
      outputJsonValid = true;
    } catch {
      outputJsonValid = false;
    }
  }
  const responseStructureValid =
    typeof record.model === "string" &&
    record.stop_reason !== undefined &&
    Array.isArray(record.content) &&
    typeof usage.input_tokens === "number" &&
    typeof usage.output_tokens === "number";
  return {
    model: typeof record.model === "string" ? record.model : undefined,
    stop_reason:
      typeof record.stop_reason === "string" ? record.stop_reason : undefined,
    input_tokens:
      typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
    output_tokens:
      typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
    responseStructureValid,
    outputJsonValid,
  };
}

/**
 * @param {import("node:http").IncomingMessage} req
 */
export function readMockRequestPath(req) {
  try {
    return new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    return undefined;
  }
}

const require = createRequire(
  resolve(repoRoot, "adapters/model-anthropic/package.json"),
);

/**
 * @returns {Promise<{
 *   buildAnthropicMessagesCreateBody: Function;
 *   anthropicErrorMetadata: Function;
 *   formatAnthropicOperatorHttpDiagnostic: Function;
 *   assessAnthropicParsedErrorForLocalDisplay: Function;
 *   formatAnthropicProviderErrorLocalInspection: Function;
 *   isAnthropicProviderErrorTextDisplayEnabled: Function;
 *   ANTHROPIC_MESSAGES_API_VERSION: string;
 *   ANTHROPIC_MESSAGES_HTTP_PATH: string;
 *   ANTHROPIC_SDK_MAX_RETRIES: number;
 *   buildBuilderGenerationMessages: Function;
 *   BuilderProposalAnthropicRecordsJsonSchema: Record<string, unknown>;
 *   sdkVersion: string;
 * }>}
 */
export async function loadAnthropicRawMessagesProbeModules() {
  const adapterUrl = pathToFileURL(
    resolve(repoRoot, "adapters/model-anthropic/dist/index.js"),
  ).href;
  const domainPromptUrl = pathToFileURL(
    resolve(
      repoRoot,
      "packages/domain/dist/builder/builder-natural-language-prompt.js",
    ),
  ).href;
  const domainSchemaUrl = pathToFileURL(
    resolve(
      repoRoot,
      "packages/domain/dist/builder/builder-proposal-anthropic-json-schema.js",
    ),
  ).href;

  const adapter = await import(adapterUrl);
  const promptMod = await import(domainPromptUrl);
  const schemaMod = await import(domainSchemaUrl);
  const sdkVersion = require(
    resolve(
      repoRoot,
      "adapters/model-anthropic/node_modules/@anthropic-ai/sdk/package.json",
    ),
  ).version;

  return {
    buildAnthropicMessagesCreateBody: adapter.buildAnthropicMessagesCreateBody,
    anthropicErrorMetadata: adapter.anthropicErrorMetadata,
    formatAnthropicOperatorHttpDiagnostic:
      adapter.formatAnthropicOperatorHttpDiagnostic,
    assessAnthropicParsedErrorForLocalDisplay:
      adapter.assessAnthropicParsedErrorForLocalDisplay,
    formatAnthropicProviderErrorLocalInspection:
      adapter.formatAnthropicProviderErrorLocalInspection,
    isAnthropicProviderErrorTextDisplayEnabled:
      adapter.isAnthropicProviderErrorTextDisplayEnabled,
    ANTHROPIC_MESSAGES_API_VERSION: adapter.ANTHROPIC_MESSAGES_API_VERSION,
    ANTHROPIC_MESSAGES_HTTP_PATH: adapter.ANTHROPIC_MESSAGES_HTTP_PATH,
    ANTHROPIC_SDK_MAX_RETRIES: adapter.ANTHROPIC_SDK_MAX_RETRIES,
    buildBuilderGenerationMessages: promptMod.buildBuilderGenerationMessages,
    BuilderProposalAnthropicRecordsJsonSchema:
      schemaMod.BuilderProposalAnthropicRecordsJsonSchema,
    sdkVersion,
  };
}

/**
 * @param {import("node:http").Server} server
 */
export async function closeListeningHttpServer(server) {
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  await new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolveClose();
    });
  });
}

export function anthropicRawMessagesBuilderInputs() {
  return {
    catalogJson: M20_7_ANTHROPIC_COUNT_TOKENS_CATALOG_JSON,
    userInstruction: M20_7_ANTHROPIC_PROBE_SMOKE_INSTRUCTION,
  };
}

export { estimateAnthropicProbeWorstCaseMicroUsd };
