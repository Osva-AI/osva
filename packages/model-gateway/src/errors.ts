import type { ModelErrorCode } from "@osva/contracts";
import { MODEL_ERROR_CODES } from "@osva/contracts";

export interface ModelGatewayErrorOptions {
  readonly retryable?: boolean;
  readonly provider?: string;
  readonly providerStatusCode?: number;
  readonly providerRequestId?: string;
  readonly retryAfterMs?: number;
}

export class ModelGatewayError extends Error {
  readonly code: ModelErrorCode;
  readonly retryable: boolean | undefined;
  readonly provider: string | undefined;
  readonly providerStatusCode: number | undefined;
  readonly providerRequestId: string | undefined;
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
