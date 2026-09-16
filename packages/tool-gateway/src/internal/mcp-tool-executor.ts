import type {
  ConnectorVersionResourceV1,
  McpClientPool,
  ToolInvokeRequest,
} from "@osva/contracts";
import type { ConnectorRepository, ToolVersion } from "@osva/domain";
import { isMcpAdapterError } from "@osva/adapters-mcp-client";

import { ToolGatewayError, toolGatewayError } from "../errors.js";

export interface McpToolExecutorDependencies {
  readonly connectors: ConnectorRepository;
  readonly mcpClientPool: McpClientPool;
}

function toConnectorVersionResource(
  version: Awaited<ReturnType<ConnectorRepository["findConnectorVersionById"]>>,
): ConnectorVersionResourceV1 {
  if (version === null) {
    throw toolGatewayError(
      "TOOL_IMPLEMENTATION_NOT_FOUND",
      "ConnectorVersion was not found.",
    );
  }

  return {
    id: version.id,
    connectorId: version.connectorId,
    version: version.version,
    kind: version.kind,
    transport: version.transport,
    transportConfig: version.transportConfig,
    auth: version.auth,
    createdAt: version.createdAt.toISOString(),
  };
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

  try {
    const result = await deps.mcpClientPool.invokeTool({
      connectorVersion: toConnectorVersionResource(connectorVersion),
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
