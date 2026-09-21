import type { McpServerConfig } from "./config.js";
import { loadMcpServerConfig } from "./config.js";
import { createBearerTokenMcpAuthenticator } from "./auth.js";
import { createMcpHttpServer } from "./http-server.js";
import { logEvent } from "./log.js";
import { createOsvaClientFactory } from "./osva-client.js";

export interface McpServerProcess {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly port?: number;
}

export function createMcpServerProcess(
  env: NodeJS.ProcessEnv = process.env,
): McpServerProcess {
  const config = loadMcpServerConfig(env);
  const authenticator = createBearerTokenMcpAuthenticator({
    tokens: config.bearerTokens,
  });
  const clients = createOsvaClientFactory(config.osvaApiBaseUrl);
  const httpServer = createMcpHttpServer({
    config,
    authenticator,
    clients,
  });

  let port: number | undefined;

  return {
    get port() {
      return port;
    },
    async start() {
      port = await httpServer.listen();
      logEvent("mcp_server.started", {
        host: config.host,
        port,
        path: config.mcpPath,
      });
    },
    async stop() {
      await httpServer.close();
      logEvent("mcp_server.stopped", {});
    },
  };
}

export type { McpServerConfig };
