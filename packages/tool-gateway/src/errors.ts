import type { ToolErrorCode } from "@osva/contracts";
import { TOOL_ERROR_CODES } from "@osva/contracts";

export class ToolGatewayError extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolGatewayError";
    this.code = code;
  }
}

export function isToolGatewayError(error: unknown): error is ToolGatewayError {
  return error instanceof ToolGatewayError;
}

export function toolGatewayError(
  code: ToolErrorCode,
  message: string,
): ToolGatewayError {
  return new ToolGatewayError(code, message);
}

export const TOOL_GATEWAY_ERROR_CODES = TOOL_ERROR_CODES;
