import type { McpPrincipal } from "@osva/contracts";
import { McpServer } from "@modelcontextprotocol/server";
import type { OsvaInstrumentation } from "@osva/observability";

import type { OsvaClientFactory } from "./osva-client.js";
import { registerOsvaMcpResources } from "./register-resources.js";
import { registerOsvaMcpTools } from "./register-tools.js";

export interface CreateOsvaMcpServerOptions {
  readonly clients: OsvaClientFactory;
  readonly instrumentation?: OsvaInstrumentation;
  readonly principal: McpPrincipal;
}

export function createOsvaMcpServer(
  options: CreateOsvaMcpServerOptions,
): McpServer {
  const server = new McpServer(
    { name: "osva-mcp-server", version: "1.0.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  registerOsvaMcpTools({
    server,
    clients: options.clients,
    instrumentation: options.instrumentation,
    principal: options.principal,
  });
  registerOsvaMcpResources({
    server,
    clients: options.clients,
    instrumentation: options.instrumentation,
    principal: options.principal,
  });

  return server;
}
