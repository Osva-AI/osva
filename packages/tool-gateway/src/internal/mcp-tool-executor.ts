import type { ConnectorRepository, ToolVersion } from "@osva/domain";
import { toMcpConnectorExecutionConfig } from "@osva/domain";
import type { McpClientPool, ToolInvokeRequest } from "@osva/contracts";
import { isMcpAdapterError } from "@osva/adapters-mcp-client";

import { ToolGatewayError, toolGatewayError } from "../errors.js";

export interface McpToolExecutorDependencies {
  readonly connectors: ConnectorRepository;
  readonly mcpClientPool: McpClientPool;
}

export async function invokeMcpToolVersion(
  deps: McpToolExecutorDependencies,
  version: ToolVersion,
  request: ToolInvokeRequest,
  options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
): Promise<unknown> {
  if (version.type !== "MCP" || version.mcp === undefined) {
    throw toolGatewayError(
      "TOOL_IMPLEMENTATION_NOT_FOUND",
      "Tool implementation was not found.",
    );
  }

  const connectorVersion = await deps.connectors.findConnectorVersionById(
    version.mcp.connectorVersionId,
  );
  if (connectorVersion === null) {
    throw toolGatewayError(
      "TOOL_IMPLEMENTATION_NOT_FOUND",
      "ConnectorVersion was not found.",
    );
  }

  const executionConfig = toMcpConnectorExecutionConfig(connectorVersion);

  try {
    const result = await deps.mcpClientPool.invokeTool({
      executionConfig,
      remoteToolName: version.mcp.remoteToolName,
      input: request.input,
      timeoutMs: options?.timeoutMs,
      signal: options?.signal,
    });

    if (result.isError) {
      throw toolGatewayError(
        "MCP_TOOL_ERROR",
        typeof result.output === "string"
          ? result.output
          : "MCP tool returned an error result.",
      );
    }

    return result.output;
  } catch (error) {
    if (error instanceof ToolGatewayError) {
      throw error;
    }

    if (isMcpAdapterError(error)) {
      throw toolGatewayError(error.code, error.message);
    }

    throw toolGatewayError(
      "MCP_PROTOCOL_ERROR",
      error instanceof Error ? error.message : "MCP tool invocation failed.",
    );
  }
}
