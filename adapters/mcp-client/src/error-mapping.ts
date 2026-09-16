import type { ToolErrorCode } from "@osva/contracts";
import {
  SdkError,
  SdkErrorCode,
  UnauthorizedError,
} from "@modelcontextprotocol/client";

import { isMcpAdapterError, mcpAdapterError } from "./errors.js";

export function mapMcpFailure(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) {
    throw mcpAdapterError(
      "CONNECTOR_CANCELLED",
      "MCP tool invocation was cancelled.",
    );
  }

  if (isMcpAdapterError(error)) {
    throw error;
  }

  if (error instanceof UnauthorizedError) {
    throw mcpAdapterError(
      "CONNECTOR_AUTHENTICATION_FAILED",
      "MCP connector authentication failed.",
    );
  }

  if (error instanceof SdkError) {
    if (error.code === SdkErrorCode.RequestTimeout) {
      throw mcpAdapterError(
        "CONNECTOR_TIMEOUT",
        "MCP tool invocation timed out.",
        true,
      );
    }

    if (error.code === SdkErrorCode.ConnectionClosed) {
      throw mcpAdapterError(
        "CONNECTOR_UNAVAILABLE",
        "MCP connector became unavailable.",
        true,
      );
    }

    if (error.code === SdkErrorCode.UnsupportedResultType) {
      throw mcpAdapterError(
        "MCP_UNSUPPORTED_INTERACTION",
        "MCP server requested unsupported interactive input.",
      );
    }

    if (error.code === SdkErrorCode.InputRequiredRoundsExceeded) {
      throw mcpAdapterError(
        "MCP_UNSUPPORTED_INTERACTION",
        "MCP server requested unsupported interactive input.",
      );
    }
  }

  const message =
    error instanceof Error ? error.message : "MCP tool invocation failed.";

  if (/not found/i.test(message)) {
    throw mcpAdapterError("MCP_TOOL_NOT_FOUND", message);
  }

  if (/invalid param|invalid argument/i.test(message)) {
    throw mcpAdapterError("MCP_INVALID_ARGUMENTS", message);
  }

  if (/timeout/i.test(message)) {
    throw mcpAdapterError("CONNECTOR_TIMEOUT", message, true);
  }

  if (/cancel/i.test(message)) {
    throw mcpAdapterError("CONNECTOR_CANCELLED", message);
  }

  if (/auth|unauthorized|forbidden|401|403/i.test(message)) {
    throw mcpAdapterError("CONNECTOR_AUTHENTICATION_FAILED", message);
  }

  if (/unavailable|connect|ECONNREFUSED|ENOTFOUND/i.test(message)) {
    throw mcpAdapterError("CONNECTOR_UNAVAILABLE", message, true);
  }

  throw mcpAdapterError(
    "MCP_PROTOCOL_ERROR",
    message,
    isRetryableCode(message),
  );
}

function isRetryableCode(message: string): boolean {
  return /unavailable|timeout|temporarily|rate limit|429|503/i.test(message);
}

export function mapMcpToolFailure(message: string): never {
  throw mcpAdapterError("MCP_TOOL_ERROR", message);
}

export function assertToolErrorCode(code: ToolErrorCode): ToolErrorCode {
  return code;
}
