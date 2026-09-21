import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type {
  ConnectorVersionResourceV1,
  DiscoveredMcpTool,
  McpToolInvokeRequest,
  McpToolInvokeResult,
  SecretResolver,
} from "@osva/contracts";
import {
  isStdioTransportConfig,
  isStreamableHttpTransportConfig,
} from "@osva/contracts";

import { resolveConnectorAuthHeaders } from "./auth-headers.js";
import { resolveStdioProcessEnvironment } from "./stdio-environment.js";
import { isMcpAdapterError, mcpAdapterError } from "./errors.js";
import { mapMcpFailure } from "./error-mapping.js";
import { normalizeMcpToolResult } from "./result-normalizer.js";

const OSVA_CLIENT_NAME = "osva-mcp-client";
const OSVA_CLIENT_VERSION = "0.0.0";

export interface ManagedMcpClientOptions {
  readonly connectorVersion: ConnectorVersionResourceV1;
  readonly secretResolver: SecretResolver;
}

export class ManagedMcpClient {
  private client: Client | undefined;
  private connectPromise: Promise<void> | undefined;
  private closed = false;

  constructor(private readonly options: ManagedMcpClientOptions) {}

  async discoverTools(options?: {
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  }): Promise<readonly DiscoveredMcpTool[]> {
    await this.ensureConnected(options?.signal);

    try {
      const client = this.requireClient();
      const result = await client.listTools(undefined, {
        timeout: options?.timeoutMs,
        signal: options?.signal as AbortSignal | undefined,
      });

      return result.tools.map((tool) => ({
        remoteToolName: tool.name,
        description: tool.description,
        inputSchema: (tool.inputSchema ?? {
          type: "object",
        }) as DiscoveredMcpTool["inputSchema"],
      }));
    } catch (error) {
      if (isMcpAdapterError(error)) {
        throw error;
      }
      mapMcpFailure(error, options?.signal);
    }
  }

  async invokeTool(
    request: McpToolInvokeRequest,
  ): Promise<McpToolInvokeResult> {
    await this.ensureConnected(request.signal as AbortSignal | undefined);

    try {
      const client = this.requireClient();
      const result = await client.callTool(
        {
          name: request.remoteToolName,
          arguments:
            request.input === undefined || request.input === null
              ? {}
              : (request.input as Record<string, unknown>),
        },
        {
          timeout: request.timeoutMs,
          signal: request.signal as AbortSignal | undefined,
        },
      );

      const normalized = normalizeMcpToolResult(result);
      return normalized;
    } catch (error) {
      if (isMcpAdapterError(error)) {
        throw error;
      }
      mapMcpFailure(error, request.signal as AbortSignal | undefined);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.client !== undefined) {
      await this.client.close();
      this.client = undefined;
    }
    this.connectPromise = undefined;
  }

  private requireClient(): Client {
    if (this.client === undefined) {
      throw mcpAdapterError(
        "CONNECTOR_UNAVAILABLE",
        "MCP client is not connected.",
        true,
      );
    }

    return this.client;
  }

  private async ensureConnected(signal?: AbortSignal): Promise<void> {
    if (this.closed) {
      throw mcpAdapterError(
        "CONNECTOR_UNAVAILABLE",
        "MCP client has been closed.",
        true,
      );
    }

    if (this.client !== undefined) {
      return;
    }

    if (this.connectPromise === undefined) {
      this.connectPromise = this.connect(signal).catch((error) => {
        this.connectPromise = undefined;
        throw error;
      });
    }

    await this.connectPromise;
  }

  private async connect(signal?: AbortSignal): Promise<void> {
    const client = new Client({
      name: OSVA_CLIENT_NAME,
      version: OSVA_CLIENT_VERSION,
    });

    const transport = await this.createTransport(signal);
    await client.connect(transport);
    this.client = client;
  }

  private async createTransport(signal?: AbortSignal) {
    const { connectorVersion, secretResolver } = this.options;
    const headers = await resolveConnectorAuthHeaders(
      connectorVersion.auth,
      secretResolver,
    );

    if (connectorVersion.transport === "STREAMABLE_HTTP") {
      const config = connectorVersion.transportConfig;
      if (!isStreamableHttpTransportConfig(config)) {
        throw mcpAdapterError(
          "MCP_PROTOCOL_ERROR",
          "Connector transport configuration does not match STREAMABLE_HTTP.",
        );
      }

      return new StreamableHTTPClientTransport(new URL(config.endpointUrl), {
        requestInit: {
          headers,
          signal,
        },
      });
    }

    const config = connectorVersion.transportConfig;
    if (!isStdioTransportConfig(config)) {
      throw mcpAdapterError(
        "MCP_PROTOCOL_ERROR",
        "Connector transport configuration does not match STDIO.",
      );
    }

    const env = await resolveStdioProcessEnvironment(config, secretResolver);

    return new StdioClientTransport({
      command: config.command,
      args: [...config.args],
      cwd: config.cwd,
      env,
      stderr: "pipe",
    });
  }
}
