import type {
  ConnectorVersionId,
  DiscoveredMcpTool,
  McpClientPool,
  McpConnectorExecutionConfig,
  McpToolInvokeRequest,
  McpToolInvokeResult,
  SecretResolver,
} from "@osva/contracts";
import {
  createPinnedOutboundFetch,
  type PinnedOutboundFetch,
} from "@osva/outbound-network";

import {
  ManagedMcpClient,
  mapOutboundNetworkError,
} from "./managed-mcp-client.js";

const MCP_FORBIDDEN_DESTINATION_MESSAGE =
  "MCP connector destination is not permitted by outbound network policy.";

export interface OsvaMcpClientPoolOptions {
  readonly secretResolver: SecretResolver;
  readonly stdioConnectorsEnabled: boolean;
  readonly allowPrivateNetworks: boolean;
  readonly pinnedFetch?: PinnedOutboundFetch;
}

export class OsvaMcpClientPool implements McpClientPool {
  private readonly clients = new Map<ConnectorVersionId, ManagedMcpClient>();
  private readonly pinnedFetch: PinnedOutboundFetch;

  constructor(private readonly options: OsvaMcpClientPoolOptions) {
    this.pinnedFetch =
      options.pinnedFetch ??
      createPinnedOutboundFetch({
        allowPrivateNetworks: options.allowPrivateNetworks,
        forbiddenDestinationMessage: MCP_FORBIDDEN_DESTINATION_MESSAGE,
      });
  }

  async discoverTools(
    executionConfig: McpConnectorExecutionConfig,
    options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
  ): Promise<readonly DiscoveredMcpTool[]> {
    const client = await this.getOrCreateClient(executionConfig);
    try {
      return await client.discoverTools(options);
    } catch (error) {
      mapOutboundNetworkError(error);
    }
  }

  async invokeTool(
    request: McpToolInvokeRequest,
  ): Promise<McpToolInvokeResult> {
    const client = await this.getOrCreateClient(request.executionConfig);
    try {
      return await client.invokeTool(request);
    } catch (error) {
      mapOutboundNetworkError(error);
    }
  }

  async close(): Promise<void> {
    const closers = [...this.clients.values()].map((client) => client.close());
    await Promise.all(closers);
    this.clients.clear();
  }

  private async getOrCreateClient(
    executionConfig: McpConnectorExecutionConfig,
  ): Promise<ManagedMcpClient> {
    const existing = this.clients.get(executionConfig.connectorVersionId);
    if (existing !== undefined) {
      return existing;
    }

    const created = new ManagedMcpClient({
      executionConfig,
      secretResolver: this.options.secretResolver,
      stdioConnectorsEnabled: this.options.stdioConnectorsEnabled,
      pinnedFetch: this.pinnedFetch,
    });
    this.clients.set(executionConfig.connectorVersionId, created);
    return created;
  }
}

export function createMcpClientPool(
  options: OsvaMcpClientPoolOptions,
): McpClientPool {
  return new OsvaMcpClientPool(options);
}
