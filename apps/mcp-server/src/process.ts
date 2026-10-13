import {
  createOpenTelemetryLifecycle,
  type OpenTelemetryLifecycle,
} from "@osva/adapters-opentelemetry";

import type { McpServerConfig } from "./config.js";
import { loadMcpServerConfig } from "./config.js";
import { createRestAuthContextMcpAuthenticator } from "./auth.js";
import { createMcpHttpServer } from "./http-server.js";
import { logEvent } from "./log.js";
import { createOsvaClientFactory } from "./osva-client.js";

export interface McpServerProcess {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly port?: number;
}

export interface McpServerProcessDependencies {
  readonly telemetry?: OpenTelemetryLifecycle;
}

export function createMcpServerProcess(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: McpServerProcessDependencies = {},
): McpServerProcess {
  const config = loadMcpServerConfig(env);
  const telemetryLifecycle =
    dependencies.telemetry ??
    createOpenTelemetryLifecycle(env, { defaultServiceName: "osva-mcp" });
  const authenticator = createRestAuthContextMcpAuthenticator({
    osvaApiBaseUrl: config.osvaApiBaseUrl,
  });
  const clients = createOsvaClientFactory(config.osvaApiBaseUrl);
  const httpServer = createMcpHttpServer({
    config,
    authenticator,
    clients,
    instrumentation: telemetryLifecycle.instrumentation,
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
      await telemetryLifecycle.shutdown();
      logEvent("mcp_server.stopped", {});
    },
  };
}

export type { McpServerConfig };
