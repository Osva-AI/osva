import http from "node:http";

import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  localhostHostValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import {
  OSVA_ATTR,
  OSVA_SPAN,
  NO_OP_INSTRUMENTATION,
  type OsvaInstrumentation,
} from "@osva/observability";

import type { McpAuthenticator } from "./auth.js";
import { McpAuthenticationServiceUnavailableError } from "./auth.js";
import type { McpServerConfig } from "./config.js";
import { createOsvaMcpServer } from "./create-osva-mcp-server.js";
import { logEvent } from "./log.js";
import type { OsvaClientFactory } from "./osva-client.js";
import {
  getMcpPrincipal,
  runWithMcpAuthenticatedIdentity,
} from "./principal-context.js";

export interface McpHttpServer {
  listen(): Promise<number>;
  close(): Promise<void>;
}

export interface CreateMcpHttpServerOptions {
  readonly config: McpServerConfig;
  readonly authenticator: McpAuthenticator;
  readonly clients: OsvaClientFactory;
  readonly instrumentation?: OsvaInstrumentation;
}

export function createMcpHttpServer(
  options: CreateMcpHttpServerOptions,
): McpHttpServer {
  const instrumentation = options.instrumentation ?? NO_OP_INSTRUMENTATION;
  const handler = createMcpHandler(() =>
    createOsvaMcpServer({
      clients: options.clients,
      instrumentation,
      principal: getMcpPrincipal(),
    }),
  );
  const mcpHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();

  const server = http.createServer((request, response) => {
    void handleRequest(request, response);
  });

  async function handleRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    if (!validateHost(request, response)) {
      return;
    }

    const path = request.url?.split("?")[0] ?? "";
    if (path === "/health" || path === "/health/") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (
      path !== options.config.mcpPath &&
      path !== `${options.config.mcpPath}/`
    ) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "not_found" }));
      return;
    }

    const method = (request.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "method_not_allowed" }));
      return;
    }

    let identity: Awaited<ReturnType<McpAuthenticator["authenticate"]>>;
    try {
      identity = await options.authenticator.authenticate(request);
    } catch (error) {
      if (error instanceof McpAuthenticationServiceUnavailableError) {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "service_unavailable" }));
        return;
      }
      throw error;
    }

    if (identity === undefined) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            category: "authentication",
            message: "Missing or invalid bearer token.",
          },
        }),
      );
      return;
    }

    await instrumentation.withSpan(
      OSVA_SPAN.MCP_INBOUND_REQUEST,
      { [OSVA_ATTR.OPERATION]: "mcp_http" },
      async () => {
        await runWithMcpAuthenticatedIdentity(identity, async () => {
          try {
            await mcpHandler(request, response);
          } catch (error) {
            logEvent("mcp_server.request_failed", {
              message: error instanceof Error ? error.message : "unknown",
            });
            if (!response.headersSent) {
              response.writeHead(500, { "content-type": "application/json" });
              response.end(JSON.stringify({ status: "internal_error" }));
            }
          }
        });
      },
    );
  }

  return {
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.config.port, options.config.host, () => {
          server.off("error", reject);
          resolve();
        });
      });

      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Failed to bind MCP HTTP server.");
      }

      return address.port;
    },
    async close() {
      await handler.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
