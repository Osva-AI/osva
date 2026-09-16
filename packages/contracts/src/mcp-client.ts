import type { ConnectorVersionId } from "./ids.js";
import type { JsonSchemaRecord } from "./json-schema.js";
import type { JsonValue } from "./json-value.js";
import type { ConnectorVersionResourceV1 } from "./connector-registry.js";

export interface DiscoveredMcpTool {
  readonly remoteToolName: string;
  readonly description?: string;
  readonly inputSchema: JsonSchemaRecord;
}

export interface McpToolInvokeRequest {
  readonly connectorVersion: ConnectorVersionResourceV1;
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
    connectorVersion: ConnectorVersionResourceV1,
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
    connectorVersion: ConnectorVersionResourceV1,
    options?: {
      readonly signal?: { readonly aborted: boolean };
      readonly timeoutMs?: number;
    },
  ): Promise<readonly DiscoveredMcpTool[]>;
  close(): Promise<void>;
}

export type McpClientPoolKey = ConnectorVersionId;
