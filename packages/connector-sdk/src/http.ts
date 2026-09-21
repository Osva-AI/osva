import http from "node:http";

import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  localhostHostValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";

import type { DefinedConnector } from "./types.js";
import { createMcpServerFromConnector } from "./connector.js";

export interface StreamableHttpHandler {
  readonly path: string;
  handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void>;
  close(): Promise<void>;
}

export interface CreateStreamableHttpHandlerOptions {
  readonly connector: DefinedConnector;
  readonly path?: string;
}

export function createStreamableHttpHandler(
  options: CreateStreamableHttpHandlerOptions,
): StreamableHttpHandler {
  const path = options.path ?? "/mcp";
  const handler = createMcpHandler(() =>
    createMcpServerFromConnector(options.connector),
  );
  const mcpHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();

  return {
    path,
    async handle(request, response) {
      if (!validateHost(request, response)) {
        return;
      }

      const urlPath = request.url?.split("?")[0] ?? "";
      if (urlPath !== path && urlPath !== `${path}/`) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "not_found" }));
        return;
      }

      try {
        await mcpHandler(request, response);
      } catch {
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ status: "internal_error" }));
        }
      }
    },
    async close() {
      await handler.close();
    },
  };
}

export interface ServeStreamableHttpOptions extends CreateStreamableHttpHandlerOptions {
  readonly host?: string;
  readonly port?: number;
}

export async function serveStreamableHttp(
  options: ServeStreamableHttpOptions,
): Promise<http.Server> {
  const streamable = createStreamableHttpHandler(options);
  const server = http.createServer((request, response) => {
    void streamable.handle(request, response);
  });

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}
