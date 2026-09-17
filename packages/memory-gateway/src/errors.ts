import type { MemoryErrorCode } from "@osva/contracts";
import { MEMORY_ERROR_CODES } from "@osva/contracts";

export class MemoryGatewayError extends Error {
  readonly code: MemoryErrorCode;

  constructor(code: MemoryErrorCode, message: string) {
    super(message);
    this.name = "MemoryGatewayError";
    this.code = code;
  }
}

export function isMemoryGatewayError(
  error: unknown,
): error is MemoryGatewayError {
  return error instanceof MemoryGatewayError;
}

export function memoryGatewayError(
  code: MemoryErrorCode,
  message: string,
): MemoryGatewayError {
  return new MemoryGatewayError(code, message);
}

export const MEMORY_GATEWAY_ERROR_CODES = MEMORY_ERROR_CODES;
