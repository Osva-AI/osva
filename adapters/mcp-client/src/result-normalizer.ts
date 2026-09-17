import type { JsonValue } from "@osva/contracts";
import { isCanonicalJsonValue } from "@osva/contracts";

import { mcpAdapterError } from "./errors.js";

interface McpContentBlock {
  readonly type?: string;
  readonly text?: string;
  readonly data?: unknown;
  readonly mimeType?: string;
}

interface McpCallToolResult {
  readonly content?: readonly McpContentBlock[];
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

export function normalizeMcpToolResult(result: McpCallToolResult): {
  readonly output: JsonValue;
  readonly isError: boolean;
} {
  if (result.structuredContent !== undefined) {
    if (!isCanonicalJsonValue(result.structuredContent)) {
      throw mcpAdapterError(
        "MCP_INVALID_RESPONSE",
        "MCP structured tool result is not JSON-compatible.",
      );
    }

    return {
      output: result.structuredContent,
      isError: result.isError === true,
    };
  }

  const blocks = result.content ?? [];
  const textParts: string[] = [];
  const structuredParts: JsonValue[] = [];
  const unsupportedTypes = new Set<string>();

  for (const block of blocks) {
    const type = block.type ?? "text";

    if (type === "text") {
      if (typeof block.text === "string") {
        textParts.push(block.text);
      }
      continue;
    }

    if (type === "resource" || type === "resource_link") {
      unsupportedTypes.add(type);
      continue;
    }

    if (block.text !== undefined && typeof block.text === "string") {
      textParts.push(block.text);
      continue;
    }

    if (block.data !== undefined && isCanonicalJsonValue(block.data)) {
      structuredParts.push(block.data);
      continue;
    }

    unsupportedTypes.add(type);
  }

  if (unsupportedTypes.size > 0) {
    throw mcpAdapterError(
      "MCP_INVALID_RESPONSE",
      `MCP tool result contains unsupported content blocks: ${[...unsupportedTypes].join(", ")}.`,
    );
  }

  if (structuredParts.length === 1 && textParts.length === 0) {
    return {
      output: structuredParts[0]!,
      isError: result.isError === true,
    };
  }

  if (structuredParts.length > 0) {
    const payload = {
      text: textParts.length > 0 ? textParts.join("\n") : undefined,
      content: structuredParts,
    };
    if (!isCanonicalJsonValue(payload)) {
      throw mcpAdapterError(
        "MCP_INVALID_RESPONSE",
        "MCP tool result could not be normalized into JSON-compatible output.",
      );
    }
    return {
      output: payload,
      isError: result.isError === true,
    };
  }

  return {
    output: textParts.join("\n"),
    isError: result.isError === true,
  };
}
