import type { ModelErrorCode } from "@osva/contracts";
import { MODEL_ERROR_CODES } from "@osva/contracts";

export class ModelGatewayError extends Error {
  readonly code: ModelErrorCode;

  constructor(code: ModelErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
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
): ModelGatewayError {
  return new ModelGatewayError(code, message);
}

export const MODEL_GATEWAY_ERROR_CODES = MODEL_ERROR_CODES;
