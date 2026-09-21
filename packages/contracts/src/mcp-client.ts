import type { DiscoveredMcpToolV1 } from "./connector-registry.js";
import type { McpConnectorExecutionConfig } from "./mcp-connector-execution.js";
import type { JsonValue } from "./json-value.js";

export type DiscoveredMcpTool = DiscoveredMcpToolV1;

export interface McpToolInvokeRequest {
  readonly executionConfig: McpConnectorExecutionConfig;
  readonly remoteToolName: string;
  readonly input: unknown;
  readonly timeoutMs?: number;
  readonly signal?: { readonly aborted: boolean };
}

export interface McpToolInvokeResult {
  readonly output: JsonValue;
  readonly isError: boolean;
}

export interface McpClientAdapter {
  discoverTools(
    executionConfig: McpConnectorExecutionConfig,
    options?: {
      readonly signal?: { readonly aborted: boolean };
      readonly timeoutMs?: number;
    },
  ): Promise<readonly DiscoveredMcpTool[]>;

  invokeTool(request: McpToolInvokeRequest): Promise<McpToolInvokeResult>;

  close(): Promise<void>;
}

export interface McpClientPool {
  invokeTool(request: McpToolInvokeRequest): Promise<McpToolInvokeResult>;
  discoverTools(
    executionConfig: McpConnectorExecutionConfig,
    options?: {
      readonly signal?: { readonly aborted: boolean };
      readonly timeoutMs?: number;
    },
  ): Promise<readonly DiscoveredMcpTool[]>;
  close(): Promise<void>;
}

export type { McpConnectorExecutionConfig } from "./mcp-connector-execution.js";
