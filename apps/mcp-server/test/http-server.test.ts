import { describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";

import { createBearerTokenMcpAuthenticator } from "../src/auth.js";
import { createMcpHttpServer } from "../src/http-server.js";
import type { OsvaClientFactory } from "../src/osva-client.js";

const noopClients: OsvaClientFactory = {
  forWorkspace() {
    throw new Error("not implemented in http-server auth test");
  },
};

describe("MCP HTTP server transport guards", () => {
  it("rejects unsupported HTTP methods before MCP handling", async () => {
    const server = createMcpHttpServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        osvaApiBaseUrl: "http://127.0.0.1:1",
        mcpPath: "/mcp",
        bearerTokens: new Map([["token", "ws-a" as WorkspaceId]]),
      },
      authenticator: createBearerTokenMcpAuthenticator({
        tokens: new Map([["token", "ws-a" as WorkspaceId]]),
      }),
      clients: noopClients,
    });

    const port = await server.listen();
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/mcp`, {
        method: "PUT",
        headers: { authorization: "Bearer token" },
      });
      expect(response.status).toBe(405);
    } finally {
      await server.close();
    }
  });

  it("returns 401 for unauthenticated MCP requests without binding principal", async () => {
    const server = createMcpHttpServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        osvaApiBaseUrl: "http://127.0.0.1:1",
        mcpPath: "/mcp",
        bearerTokens: new Map([["token", "ws-a" as WorkspaceId]]),
      },
      authenticator: createBearerTokenMcpAuthenticator({
        tokens: new Map([["token", "ws-a" as WorkspaceId]]),
      }),
      clients: noopClients,
    });

    const port = await server.listen();
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  });
});
