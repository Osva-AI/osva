import type {
  ConnectorVersionId,
  ConnectorVersionResourceV1,
  DiscoveredMcpTool,
  McpClientPool,
  McpToolInvokeRequest,
  McpToolInvokeResult,
  SecretResolver,
} from "@osva/contracts";

import { ManagedMcpClient } from "./managed-mcp-client.js";

export interface OsvaMcpClientPoolOptions {
  readonly secretResolver: SecretResolver;
}

export class OsvaMcpClientPool implements McpClientPool {
  private readonly clients = new Map<ConnectorVersionId, ManagedMcpClient>();

  constructor(private readonly options: OsvaMcpClientPoolOptions) {}

  async discoverTools(
    connectorVersion: ConnectorVersionResourceV1,
    options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
  ): Promise<readonly DiscoveredMcpTool[]> {
    const client = await this.getOrCreateClient(connectorVersion);
    return client.discoverTools(options);
  }

  async invokeTool(
    request: McpToolInvokeRequest,
  ): Promise<McpToolInvokeResult> {
    const client = await this.getOrCreateClient(request.connectorVersion);
    return client.invokeTool(request);
  }

  async close(): Promise<void> {
    const closers = [...this.clients.values()].map((client) => client.close());
    await Promise.all(closers);
    this.clients.clear();
  }

  private async getOrCreateClient(
    connectorVersion: ConnectorVersionResourceV1,
  ): Promise<ManagedMcpClient> {
    const existing = this.clients.get(connectorVersion.id);
    if (existing !== undefined) {
      return existing;
    }

    const created = new ManagedMcpClient({
      connectorVersion,
      secretResolver: this.options.secretResolver,
    });
    this.clients.set(connectorVersion.id, created);
    return created;
  }
}

export function createMcpClientPool(
  options: OsvaMcpClientPoolOptions,
): McpClientPool {
  return new OsvaMcpClientPool(options);
}
