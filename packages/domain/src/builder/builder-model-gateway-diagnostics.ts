import type { ModelErrorCode } from "@osva-ai/contracts";
import {
  MODEL_ERROR_CODES,
  isModelErrorCode,
  type ModelProvider,
} from "@osva-ai/contracts";

import type {
  BuilderGenerationErrorCode,
  BuilderGenerationFailureV1,
} from "./builder-natural-language-generation-types.js";

/** Sanitized provider failure metadata for builder HTTP 422 bodies (no prompts or raw bodies). */
export interface BuilderGenerationProviderDiagnosticV1 {
  readonly modelGatewayErrorCode: ModelErrorCode;
  readonly provider?: ModelProvider;
  readonly providerHttpStatus?: number;
  readonly providerErrorType?: string;
  readonly providerErrorCode?: string;
  readonly providerErrorParam?: string;
  readonly providerRequestId?: string;
  readonly retryable?: boolean;
  /** True when the adapter observed an HTTP status from the provider. */
  readonly providerHttpResponseObserved: boolean;
  /** Bounded transport-layer category when no parsed provider error body exists. */
  readonly providerTransportErrorCategory?: string;
  /** Present only when OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS is enabled locally. */
  readonly providerErrorReasonFingerprint?: string;
  readonly providerErrorReasonTokens?: readonly string[];
}

const ALLOWED_PROVIDER_TOKENS: Readonly<Record<string, ModelProvider>> = {
  openai: "OPENAI",
  anthropic: "ANTHROPIC",
  google_gemini: "GOOGLE_GEMINI",
  "google-gemini": "GOOGLE_GEMINI",
};

const ALLOWED_TRANSPORT_ERROR_CATEGORIES = new Set([
  "request_construction",
  "request_serialization",
  "connection_failed",
  "response_body_read_failed",
  "response_body_parse_failed",
]);

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;

export interface ModelGatewayErrorLike {
  readonly code: ModelErrorCode;
  readonly message: string;
  readonly provider?: string;
  readonly providerStatusCode?: number;
  readonly providerErrorType?: string;
  readonly providerErrorCode?: string;
  readonly providerErrorParam?: string;
  readonly providerRequestId?: string;
  readonly retryable?: boolean;
  readonly providerTransportErrorCategory?: string;
  readonly providerErrorReasonFingerprint?: string;
  readonly providerErrorReasonTokens?: readonly string[];
}

export function readModelGatewayErrorLike(
  error: unknown,
): ModelGatewayErrorLike | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  if (typeof record.code !== "string" || !isModelErrorCode(record.code)) {
    return undefined;
  }

  if (typeof record.message !== "string") {
    return undefined;
  }

  return {
    code: record.code,
    message: record.message,
    provider: typeof record.provider === "string" ? record.provider : undefined,
    providerStatusCode:
      typeof record.providerStatusCode === "number" &&
      Number.isInteger(record.providerStatusCode)
        ? record.providerStatusCode
        : undefined,
    providerErrorType:
      typeof record.providerErrorType === "string"
        ? record.providerErrorType
        : undefined,
    providerErrorCode:
      typeof record.providerErrorCode === "string"
        ? record.providerErrorCode
        : undefined,
    providerErrorParam:
      typeof record.providerErrorParam === "string"
        ? record.providerErrorParam
        : undefined,
    providerRequestId:
      typeof record.providerRequestId === "string"
        ? record.providerRequestId
        : undefined,
    retryable:
      typeof record.retryable === "boolean" ? record.retryable : undefined,
    providerTransportErrorCategory:
      typeof record.providerTransportErrorCategory === "string"
        ? record.providerTransportErrorCategory
        : undefined,
    providerErrorReasonFingerprint:
      typeof record.providerErrorReasonFingerprint === "string"
        ? record.providerErrorReasonFingerprint
        : undefined,
    providerErrorReasonTokens: Array.isArray(record.providerErrorReasonTokens)
      ? record.providerErrorReasonTokens.filter(
          (item): item is string => typeof item === "string",
        )
      : undefined,
  };
}

function sanitizeToken(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || !SAFE_TOKEN.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function sanitizeProvider(
  value: string | undefined,
): ModelProvider | undefined {
  if (value === undefined) {
    return undefined;
  }

  return ALLOWED_PROVIDER_TOKENS[value.trim().toLowerCase()];
}

function sanitizeTransportErrorCategory(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!ALLOWED_TRANSPORT_ERROR_CATEGORIES.has(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function sanitizeHttpStatus(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isInteger(value)) {
    return undefined;
  }

  if (value < 100 || value > 599) {
    return undefined;
  }

  return value;
}

export function sanitizeBuilderProviderDiagnostic(
  error: ModelGatewayErrorLike,
): BuilderGenerationProviderDiagnosticV1 {
  const providerHttpStatus = sanitizeHttpStatus(error.providerStatusCode);

  return {
    modelGatewayErrorCode: error.code,
    provider: sanitizeProvider(error.provider),
    providerHttpStatus,
    providerErrorType: sanitizeToken(error.providerErrorType),
    providerErrorCode: sanitizeToken(error.providerErrorCode),
    providerErrorParam: sanitizeToken(error.providerErrorParam),
    providerRequestId: sanitizeToken(error.providerRequestId),
    retryable: error.retryable,
    providerHttpResponseObserved: providerHttpStatus !== undefined,
    providerTransportErrorCategory: sanitizeTransportErrorCategory(
      error.providerTransportErrorCategory,
    ),
    providerErrorReasonFingerprint: sanitizeToken(
      error.providerErrorReasonFingerprint,
    ),
    providerErrorReasonTokens:
      error.providerErrorReasonTokens === undefined
        ? undefined
        : error.providerErrorReasonTokens
            .map((token) => sanitizeToken(token))
            .filter((token): token is string => token !== undefined),
  };
}

function builderMessageForModelGatewayCode(code: ModelErrorCode): string {
  if (code === MODEL_ERROR_CODES.MODEL_REQUEST_TIMEOUT) {
    return "The model provider request timed out.";
  }

  if (
    code === MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE ||
    code === MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR ||
    code === MODEL_ERROR_CODES.MODEL_QUOTA_EXHAUSTED
  ) {
    return "The configured model provider is unavailable.";
  }

  if (code === MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE) {
    return "The model provider returned no usable textual output.";
  }

  if (code === MODEL_ERROR_CODES.MODEL_INVALID_REQUEST) {
    return "The model provider rejected the request.";
  }

  if (code === MODEL_ERROR_CODES.MODEL_RATE_LIMITED) {
    return "The model provider rate-limited the request.";
  }

  if (code === MODEL_ERROR_CODES.MODEL_NOT_FOUND) {
    return "The configured model was not found at the provider.";
  }

  return "The model provider returned an error.";
}

function builderErrorCodeForModelGatewayCode(
  code: ModelErrorCode,
): BuilderGenerationErrorCode {
  if (code === MODEL_ERROR_CODES.MODEL_REQUEST_TIMEOUT) {
    return "PROVIDER_TIMEOUT";
  }

  if (
    code === MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE ||
    code === MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR ||
    code === MODEL_ERROR_CODES.MODEL_QUOTA_EXHAUSTED
  ) {
    return "PROVIDER_UNAVAILABLE";
  }

  if (code === MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE) {
    return "INVALID_JSON_OUTPUT";
  }

  return "PROVIDER_ERROR";
}

export function mapModelGatewayErrorToBuilderFailure(
  error: ModelGatewayErrorLike,
  partial?: Partial<BuilderGenerationFailureV1>,
): BuilderGenerationFailureV1 {
  const providerDiagnostic = sanitizeBuilderProviderDiagnostic(error);
  return {
    ok: false,
    errorCode: builderErrorCodeForModelGatewayCode(error.code),
    message: builderMessageForModelGatewayCode(error.code),
    providerDiagnostic,
    ...partial,
  };
}
