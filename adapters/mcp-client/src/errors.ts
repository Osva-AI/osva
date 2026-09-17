import type { ToolErrorCode } from "@osva/contracts";

export class McpAdapterError extends Error {
  readonly code: ToolErrorCode;
  readonly retryable: boolean;

  constructor(code: ToolErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "McpAdapterError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function isMcpAdapterError(error: unknown): error is McpAdapterError {
  return error instanceof McpAdapterError;
}

export function mcpAdapterError(
  code: ToolErrorCode,
  message: string,
  retryable = false,
): McpAdapterError {
  return new McpAdapterError(code, message, retryable);
}
