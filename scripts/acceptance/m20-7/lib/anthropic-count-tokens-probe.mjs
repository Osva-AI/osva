/**
 * M20.7.4 — Anthropic count_tokens operator diagnostic (non-generation).
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export const ANTHROPIC_COUNT_TOKENS_EXECUTE_ENV =
  "OSVA_M20_7_ANTHROPIC_COUNT_TOKENS_EXECUTE";
export const ANTHROPIC_COUNT_TOKENS_MOCK_ENV =
  "OSVA_M20_7_ANTHROPIC_COUNT_TOKENS_MOCK";

export const M20_7_ANTHROPIC_PROBE_SMOKE_INSTRUCTION =
  "Create a workflow that summarizes weekly product feedback. The agent should identify recurring themes, highlight critical issues, and produce actionable recommendations. Do not use external tools.";

/** Minimal catalog footprint for token estimation (full catalog not required for shape check). */
export const M20_7_ANTHROPIC_COUNT_TOKENS_CATALOG_JSON = JSON.stringify({
  schemaVersion: "1",
  models: [],
  tools: [],
});

/**
 * @param {string} url
 */
export function assertAnthropicCountTokensUrl(url) {
  const { pathname } = new URL(url);
  if (pathname !== "/v1/messages/count_tokens") {
    throw new Error(
      `refused: pathname must be /v1/messages/count_tokens (got ${pathname})`,
    );
  }
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
export function anthropicCountTokensRequestUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, "");
  const url = `${normalized}/v1/messages/count_tokens`;
  assertAnthropicCountTokensUrl(url);
  return url;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | undefined}
 */
export function anthropicCountTokensExecuteBlockedReason(env) {
  if (env[ANTHROPIC_COUNT_TOKENS_EXECUTE_ENV] !== "1") {
    return `${ANTHROPIC_COUNT_TOKENS_EXECUTE_ENV} not set`;
  }
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    return "ANTHROPIC_API_KEY missing";
  }
  return undefined;
}

/**
 * @param {string} outcome
 * @returns {number}
 */
export function anthropicCountTokensProbeExitCode(outcome) {
  if (outcome === "COUNT_TOKENS_OK" || outcome === "PROBE_DRY_RUN") {
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
export function buildAnthropicCountTokensHeaders(headers) {
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
 *   buildAnthropicMessagesCountTokensBody: Function;
 *   anthropicErrorMetadata: Function;
 *   formatAnthropicOperatorHttpDiagnostic: Function;
 *   ANTHROPIC_MESSAGES_API_VERSION: string;
 *   ANTHROPIC_COUNT_TOKENS_HTTP_PATH: string;
 *   buildBuilderGenerationMessages: Function;
 *   BuilderProposalAnthropicRecordsJsonSchema: Record<string, unknown>;
 *   sdkVersion: string;
 * }>}
 */
export async function loadAnthropicCountTokensProbeModules() {
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
    buildAnthropicMessagesCountTokensBody:
      adapter.buildAnthropicMessagesCountTokensBody,
    anthropicErrorMetadata: adapter.anthropicErrorMetadata,
    formatAnthropicOperatorHttpDiagnostic:
      adapter.formatAnthropicOperatorHttpDiagnostic,
    ANTHROPIC_MESSAGES_API_VERSION: adapter.ANTHROPIC_MESSAGES_API_VERSION,
    ANTHROPIC_COUNT_TOKENS_HTTP_PATH: adapter.ANTHROPIC_COUNT_TOKENS_HTTP_PATH,
    buildBuilderGenerationMessages: promptMod.buildBuilderGenerationMessages,
    BuilderProposalAnthropicRecordsJsonSchema:
      schemaMod.BuilderProposalAnthropicRecordsJsonSchema,
    sdkVersion,
  };
}

/**
 * @param {unknown} parsed
 * @returns {number | undefined}
 */
export function readCountTokensInputTokens(parsed) {
  if (parsed === null || typeof parsed !== "object") {
    return undefined;
  }
  const inputTokens = /** @type {{ input_tokens?: unknown }} */ (parsed)
    .input_tokens;
  return typeof inputTokens === "number" ? inputTokens : undefined;
}
