import type { ModelGatewayErrorOptions } from "@osva/model-gateway";

import {
  type AnthropicClassifiedInvalidRequestCode,
  ANTHROPIC_CLASSIFIED_INVALID_REQUEST_CODES,
} from "./anthropic-invalid-request-codes.js";
import {
  extractAnthropicProviderErrorReasonTokens,
  fingerprintAnthropicProviderErrorMessage,
  isAnthropicProviderErrorDiagnosticsEnabled,
} from "./anthropic-provider-error-fingerprint.js";
import {
  readAnthropicSdkProviderErrorType,
  readAnthropicSdkProviderMessage,
} from "./anthropic-sdk-error-body.js";

const ANTHROPIC_PROVIDER = "anthropic" as const;

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;

const CLASSIFIED_CODES = new Set<string>(
  ANTHROPIC_CLASSIFIED_INVALID_REQUEST_CODES,
);

type AnthropicApiError = {
  readonly status?: number;
  readonly headers?: Headers;
  readonly error?: unknown;
  readonly requestID?: string | null;
};

export type AnthropicProviderErrorMetadata = Pick<
  ModelGatewayErrorOptions,
  | "provider"
  | "providerStatusCode"
  | "providerRequestId"
  | "providerErrorType"
  | "providerErrorCode"
  | "providerErrorParam"
> & {
  readonly providerErrorReasonFingerprint?: string;
  readonly providerErrorReasonTokens?: readonly string[];
};

export function anthropicErrorMetadata(
  error: AnthropicApiError,
): AnthropicProviderErrorMetadata {
  const body = parseAnthropicErrorBody(error);
  const requestId =
    sanitizeProviderToken(error.requestID ?? undefined) ??
    sanitizeProviderToken(error.headers?.get("request-id") ?? undefined);

  const diagnosticsEnabled = isAnthropicProviderErrorDiagnosticsEnabled();
  const providerMessage = readAnthropicSdkProviderMessage(error.error);

  return {
    provider: ANTHROPIC_PROVIDER,
    providerStatusCode: error.status,
    providerRequestId: requestId,
    providerErrorType: body.errorType,
    providerErrorCode: body.errorCode,
    providerErrorParam: body.errorParam,
    ...(diagnosticsEnabled
      ? {
          providerErrorReasonFingerprint:
            fingerprintAnthropicProviderErrorMessage(providerMessage),
          providerErrorReasonTokens:
            extractAnthropicProviderErrorReasonTokens(providerMessage),
        }
      : {}),
  };
}

function parseAnthropicErrorBody(error: AnthropicApiError): {
  readonly errorType: string | undefined;
  readonly errorCode: string | undefined;
  readonly errorParam: string | undefined;
} {
  const raw = error.error;
  if (raw === null || typeof raw !== "object") {
    return {
      errorType: undefined,
      errorCode: "unrecognized_request",
      errorParam: undefined,
    };
  }

  const errorType = sanitizeProviderToken(
    readAnthropicSdkProviderErrorType(raw),
  );
  const message = readAnthropicSdkProviderMessage(raw);
  const classified = classifyAnthropicInvalidRequest(errorType, message);

  return {
    errorType,
    errorCode: classified.errorCode,
    errorParam: classified.errorParam,
  };
}

function classifyAnthropicInvalidRequest(
  errorType: string | undefined,
  message: string | undefined,
): {
  readonly errorCode: AnthropicClassifiedInvalidRequestCode;
  readonly errorParam: string | undefined;
} {
  const errorParam = inferErrorParam(message);

  if (message === undefined) {
    return {
      errorCode:
        errorType === "invalid_request_error"
          ? "unrecognized_request"
          : "unrecognized_request",
      errorParam,
    };
  }

  const lower = message.toLowerCase();

  if (lower.includes("anthropic-workspace-id is required")) {
    return {
      errorCode: "workspace_selection_required",
      errorParam: "anthropic-workspace-id",
    };
  }

  if (
    lower.includes("anthropic-workspace-id") &&
    (lower.includes("valid workspace") ||
      lower.includes("must be a valid") ||
      lower.includes("must be"))
  ) {
    return {
      errorCode: "workspace_selection_invalid",
      errorParam: "anthropic-workspace-id",
    };
  }

  if (lower.includes("workspace") && lower.includes("not found")) {
    return { errorCode: "workspace_selection_invalid", errorParam };
  }

  if (
    lower.includes("spend limit") ||
    lower.includes("spending limit") ||
    lower.includes("usage limit")
  ) {
    return { errorCode: "organization_spend_limit", errorParam };
  }

  if (
    lower.includes("compiled grammar is too large") ||
    lower.includes("grammar is too large")
  ) {
    return { errorCode: "compiled_grammar_too_large", errorParam };
  }

  if (lower.includes("schema is too complex")) {
    return { errorCode: "schema_too_complex", errorParam };
  }

  if (
    lower.includes("invalid schema") ||
    lower.includes("invalid json schema")
  ) {
    return { errorCode: "unsupported_schema_feature", errorParam };
  }

  if (
    lower.includes("optional parameters") &&
    (lower.includes("limit") || lower.includes("maximum"))
  ) {
    return { errorCode: "unsupported_schema_feature", errorParam };
  }

  if (
    lower.includes("union") &&
    (lower.includes("limit") || lower.includes("maximum"))
  ) {
    return { errorCode: "unsupported_schema_feature", errorParam };
  }

  if (
    lower.includes("output_format") &&
    (lower.includes("not supported") ||
      lower.includes("deprecated") ||
      lower.includes("removed"))
  ) {
    return {
      errorCode: "unsupported_parameter",
      errorParam: errorParam ?? "output_format",
    };
  }

  if (
    lower.includes("is not supported") &&
    (lower.includes("schema") ||
      lower.includes("property") ||
      lower.includes("output_config"))
  ) {
    return { errorCode: "unsupported_schema_feature", errorParam };
  }

  if (
    lower.includes("unknown") &&
    (lower.includes("parameter") || lower.includes("field"))
  ) {
    return { errorCode: "unsupported_parameter", errorParam };
  }

  if (lower.includes("unsupported") && lower.includes("parameter")) {
    return { errorCode: "unsupported_parameter", errorParam };
  }

  if (
    lower.includes("malformed") &&
    (lower.includes("message") || lower.includes("messages"))
  ) {
    return { errorCode: "malformed_message", errorParam };
  }

  if (errorType === "invalid_request_error") {
    return { errorCode: "other_invalid_request", errorParam };
  }

  return { errorCode: "unrecognized_request", errorParam };
}

function inferErrorParam(message: string | undefined): string | undefined {
  if (message === undefined) {
    return undefined;
  }

  const colonIndex = message.indexOf(":");
  if (colonIndex > 0) {
    const paramPrefix = message.slice(0, colonIndex).trim();
    if (SAFE_TOKEN.test(paramPrefix)) {
      return paramPrefix;
    }
  }

  if (
    message.toLowerCase().includes("anthropic-workspace-id") &&
    message.toLowerCase().includes("header")
  ) {
    return "anthropic-workspace-id";
  }

  return undefined;
}

function sanitizeProviderToken(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || !SAFE_TOKEN.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

export function isAnthropicClassifiedInvalidRequestCode(
  value: string | undefined,
): value is AnthropicClassifiedInvalidRequestCode {
  return value !== undefined && CLASSIFIED_CODES.has(value);
}
