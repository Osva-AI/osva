import type { ModelErrorCode } from "@osva-ai/contracts";
import { MODEL_ERROR_CODES } from "@osva-ai/contracts";

export interface ModelGatewayErrorOptions {
  readonly retryable?: boolean;
  readonly provider?: string;
  readonly providerStatusCode?: number;
  readonly providerRequestId?: string;
  /** Sanitized provider error category (for example OpenAI `error.type`). */
  readonly providerErrorType?: string;
  /** Sanitized provider error code when exposed by the API. */
  readonly providerErrorCode?: string;
  /** Sanitized provider parameter identifier when exposed by the API. */
  readonly providerErrorParam?: string;
  /**
   * Opt-in SHA-256 fingerprint (first 16 hex chars) of normalized provider text.
   * Set only when OSVA_ANTHROPIC_PROVIDER_ERROR_DIAGNOSTICS is enabled.
   */
  readonly providerErrorReasonFingerprint?: string;
  /** Allowlisted reason tokens extracted from provider text (diagnostics mode). */
  readonly providerErrorReasonTokens?: readonly string[];
  /** Bounded transport-layer category when the failure occurred before or during transport parsing. */
  readonly providerTransportErrorCategory?: string;
  readonly retryAfterMs?: number;
}

export class ModelGatewayError extends Error {
  readonly code: ModelErrorCode;
  readonly retryable: boolean | undefined;
  readonly provider: string | undefined;
  readonly providerStatusCode: number | undefined;
  readonly providerRequestId: string | undefined;
  readonly providerErrorType: string | undefined;
  readonly providerErrorCode: string | undefined;
  readonly providerErrorParam: string | undefined;
  readonly providerErrorReasonFingerprint: string | undefined;
  readonly providerErrorReasonTokens: readonly string[] | undefined;
  readonly providerTransportErrorCategory: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    code: ModelErrorCode,
    message: string,
    options?: ModelGatewayErrorOptions,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryable = options?.retryable;
    this.provider = options?.provider;
    this.providerStatusCode = options?.providerStatusCode;
    this.providerRequestId = options?.providerRequestId;
    this.providerErrorType = options?.providerErrorType;
    this.providerErrorCode = options?.providerErrorCode;
    this.providerErrorParam = options?.providerErrorParam;
    this.providerErrorReasonFingerprint =
      options?.providerErrorReasonFingerprint;
    this.providerErrorReasonTokens = options?.providerErrorReasonTokens;
    this.providerTransportErrorCategory =
      options?.providerTransportErrorCategory;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export function isModelGatewayError(
  error: unknown,
): error is ModelGatewayError {
  return error instanceof ModelGatewayError;
}

export function modelGatewayError(
  code: ModelErrorCode,
  message: string,
  options?: ModelGatewayErrorOptions,
): ModelGatewayError {
  return new ModelGatewayError(code, message, options);
}

export const MODEL_GATEWAY_ERROR_CODES = MODEL_ERROR_CODES;
