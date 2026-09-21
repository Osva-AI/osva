import { OSVA_MCP_ERROR_CATEGORY } from "@osva/contracts";

export class McpServerError extends Error {
  readonly category: string;
  readonly isClientError: boolean;

  constructor(
    category: string,
    message: string,
    options?: { readonly isClientError?: boolean; readonly cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "McpServerError";
    this.category = category;
    this.isClientError = options?.isClientError ?? false;
  }
}

export function invalidInput(message: string): McpServerError {
  return new McpServerError(OSVA_MCP_ERROR_CATEGORY.INVALID_INPUT, message, {
    isClientError: true,
  });
}

export function notFound(message: string): McpServerError {
  return new McpServerError(OSVA_MCP_ERROR_CATEGORY.NOT_FOUND, message, {
    isClientError: true,
  });
}

export function forbidden(message: string): McpServerError {
  return new McpServerError(OSVA_MCP_ERROR_CATEGORY.AUTHORIZATION, message, {
    isClientError: true,
  });
}

export function upstream(message: string, cause?: unknown): McpServerError {
  return new McpServerError(OSVA_MCP_ERROR_CATEGORY.UPSTREAM, message, {
    cause,
  });
}
