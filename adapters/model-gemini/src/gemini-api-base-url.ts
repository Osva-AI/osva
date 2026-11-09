export const GEMINI_DEFAULT_API_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

/**
 * Connection records often store the API host without the version segment.
 * generateContent lives under /v1beta/models/{model}:generateContent.
 */
export function normalizeGeminiProviderBaseUrl(
  baseURL: string | undefined,
): string {
  const trimmed = (baseURL ?? GEMINI_DEFAULT_API_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  if (trimmed.length === 0) {
    return GEMINI_DEFAULT_API_BASE_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  if (parsed.hostname !== "generativelanguage.googleapis.com") {
    return trimmed;
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/") {
    return GEMINI_DEFAULT_API_BASE_URL;
  }

  if (path.endsWith("/v1beta") || path.endsWith("/v1")) {
    return `${parsed.protocol}//${parsed.host}${path}`;
  }

  return trimmed;
}

export type GeminiAuthMechanism = "query_key";

export interface GeminiOutboundGenerateContentMetadataV1 {
  readonly method: "POST";
  readonly hostname: string;
  readonly pathname: string;
  readonly effectiveModelId: string;
  readonly authMechanism: GeminiAuthMechanism;
  readonly credentialPresent: boolean;
  readonly structuredOutputField:
    "responseJsonSchema" | "responseSchema" | "none";
}

export function describeGeminiOutboundGenerateContentRequest(input: {
  readonly baseURL: string;
  readonly model: string;
  readonly apiKey: string;
  readonly usesResponseJsonSchema: boolean;
  readonly usesResponseSchema: boolean;
}): GeminiOutboundGenerateContentMetadataV1 {
  const normalized = normalizeGeminiProviderBaseUrl(input.baseURL);
  const pathname = `/models/${input.model}:generateContent`;
  let hostname = "unknown";
  try {
    hostname = new URL(normalized).hostname;
  } catch {
    hostname = "invalid";
  }

  let structuredOutputField: GeminiOutboundGenerateContentMetadataV1["structuredOutputField"] =
    "none";
  if (input.usesResponseJsonSchema) {
    structuredOutputField = "responseJsonSchema";
  } else if (input.usesResponseSchema) {
    structuredOutputField = "responseSchema";
  }

  return {
    method: "POST",
    hostname,
    pathname,
    effectiveModelId: input.model,
    authMechanism: "query_key",
    credentialPresent: input.apiKey.trim().length > 0,
    structuredOutputField,
  };
}

export function geminiGenerateContentPathname(modelId: string): string {
  return `/models/${encodeURIComponent(modelId)}:generateContent`;
}
