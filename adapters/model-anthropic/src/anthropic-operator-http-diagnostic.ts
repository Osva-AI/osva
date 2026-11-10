import type { AnthropicProviderErrorMetadata } from "./anthropic-provider-error-metadata.js";

export type AnthropicOperatorRejectionCategory =
  | "schema_output"
  | "workspace_selection"
  | "spending_limit"
  | "request_shape"
  | "unclassified_invalid_request"
  | "other";

/**
 * Buckets classified providerErrorCode for operator stderr (not Console/BFF).
 */
export function bucketAnthropicOperatorRejectionCategory(
  providerErrorCode: string | undefined,
): AnthropicOperatorRejectionCategory {
  switch (providerErrorCode) {
    case "compiled_grammar_too_large":
    case "schema_too_complex":
    case "unsupported_schema_feature":
      return "schema_output";
    case "workspace_selection_required":
    case "workspace_selection_invalid":
      return "workspace_selection";
    case "organization_spend_limit":
      return "spending_limit";
    case "unsupported_parameter":
    case "malformed_message":
    case "unrecognized_request":
      return "request_shape";
    case "other_invalid_request":
      return "unclassified_invalid_request";
    default:
      return "other";
  }
}

export interface AnthropicOperatorHttpDiagnosticLine {
  readonly kind: "anthropic_operator_http_diagnostic";
  readonly provider: "anthropic";
  readonly providerStatusCode?: number;
  readonly providerRequestId?: string;
  readonly providerErrorType?: string;
  readonly providerErrorCode?: string;
  readonly providerErrorParam?: string;
  readonly rejectionCategory: AnthropicOperatorRejectionCategory;
  readonly providerErrorReasonFingerprint?: string;
  readonly providerErrorReasonTokens?: readonly string[];
  readonly note: "structured_only_no_raw_provider_message";
}

/**
 * JSON-safe operator diagnostic (no raw provider message).
 */
export function formatAnthropicOperatorHttpDiagnostic(
  meta: AnthropicProviderErrorMetadata,
): string {
  const line: AnthropicOperatorHttpDiagnosticLine = {
    kind: "anthropic_operator_http_diagnostic",
    provider: "anthropic",
    providerStatusCode: meta.providerStatusCode,
    providerRequestId: meta.providerRequestId,
    providerErrorType: meta.providerErrorType,
    providerErrorCode: meta.providerErrorCode,
    providerErrorParam: meta.providerErrorParam,
    rejectionCategory: bucketAnthropicOperatorRejectionCategory(
      meta.providerErrorCode,
    ),
    providerErrorReasonFingerprint: meta.providerErrorReasonFingerprint,
    providerErrorReasonTokens: meta.providerErrorReasonTokens,
    note: "structured_only_no_raw_provider_message",
  };
  return JSON.stringify(line);
}

export function emitAnthropicOperatorHttpDiagnostic(
  write: (line: string) => void,
  meta: AnthropicProviderErrorMetadata,
): void {
  write(`${formatAnthropicOperatorHttpDiagnostic(meta)}\n`);
}
