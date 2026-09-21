import { ConnectorSdkError } from "./errors.js";

export interface McpToolCallResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly structuredContent?: Record<string, unknown>;
  readonly isError?: boolean;
}

export function toMcpToolResult(output: unknown): McpToolCallResult {
  if (output !== null && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(record),
        },
      ],
      structuredContent: record,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(output ?? null),
      },
    ],
    structuredContent:
      output === null || output === undefined
        ? {}
        : { value: output as unknown },
  };
}

export function toMcpToolError(error: unknown): McpToolCallResult {
  if (error instanceof ConnectorSdkError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          }),
        },
      ],
      structuredContent: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    };
  }

  const message =
    error instanceof Error ? error.message : "Connector tool execution failed.";

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ code: "TOOL_ERROR", message }),
      },
    ],
    structuredContent: {
      code: "TOOL_ERROR",
      message,
    },
  };
}
