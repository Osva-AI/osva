import http from "node:http";

import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  localhostHostValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";

import {
  FAKE_MCP_BEARER_TOKEN,
  createFakeMcpServer,
} from "./fake-mcp-server-core.js";

export { FAKE_MCP_BEARER_TOKEN };

export interface FakeHttpMcpServer {
  readonly origin: string;
  readonly endpointUrl: string;
  readonly toolCallCount: number;
  resetToolCallCount(): void;
  close(): Promise<void>;
  waitForAbort(): Promise<void>;
}

export interface StartFakeHttpMcpServerOptions {
  readonly requireAuth?: boolean;
}

export async function startFakeHttpMcpServer(
  options: StartFakeHttpMcpServerOptions = {},
): Promise<FakeHttpMcpServer> {
  const toolCallCount = { value: 0 };
  const hangAbortWaiters: Array<() => void> = [];
  let abortWaiter: (() => void) | undefined;

  const handler = createMcpHandler(() =>
    createFakeMcpServer({ toolCallCount, hangAbortWaiters }),
  );
  const mcpHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();

  const server = http.createServer((req, res) => {
    if (!validateHost(req, res)) {
      return;
    }

    if (options.requireAuth === true && !isAuthorized(req)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "invalid bearer token",
            type: "authentication_error",
          },
        }),
      );
      return;
    }

    req.on("aborted", () => {
      abortWaiter?.();
      for (const notify of hangAbortWaiters.splice(0)) {
        notify();
      }
    });

    void mcpHandler(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal server error" }));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to bind fake MCP HTTP server.");
  }

  const origin = `http://127.0.0.1:${String(address.port)}`;

  return {
    origin,
    endpointUrl: origin,
    get toolCallCount() {
      return toolCallCount.value;
    },
    resetToolCallCount() {
      toolCallCount.value = 0;
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
    waitForAbort() {
      return new Promise((resolve) => {
        abortWaiter = resolve;
      });
    },
  };
}

function isAuthorized(req: http.IncomingMessage): boolean {
  const authorization = headerValue(req.headers.authorization);
  if (authorization === undefined) {
    return false;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (match === null) {
    return false;
  }

  return match[1] === FAKE_MCP_BEARER_TOKEN;
}

function headerValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  return value[0];
}
