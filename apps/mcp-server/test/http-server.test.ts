import { describe, expect, it } from "vitest";
import type { ApiKeyId, WorkspaceId } from "@osva/contracts";

import { createMcpHttpServer } from "../src/http-server.js";
import {
  McpAuthenticationServiceUnavailableError,
  type AuthenticatedMcpIdentity,
  type McpAuthenticator,
} from "../src/auth.js";
import type { OsvaClientFactory } from "../src/osva-client.js";

const noopClients: OsvaClientFactory = {
  forPrincipal() {
    throw new Error("not implemented in http-server auth test");
  },
};

function mockAuthenticator(
  identity?: AuthenticatedMcpIdentity,
): McpAuthenticator {
  return {
    authenticate: async () => identity,
  };
}

const sampleIdentity: AuthenticatedMcpIdentity = {
  principal: {
    subjectId: "ak-a" as ApiKeyId,
    workspaceId: "ws-a" as WorkspaceId,
    role: "ADMIN",
  },
  bearerCredential: "token",
};

describe("MCP HTTP server transport guards", () => {
  it("rejects unsupported HTTP methods before MCP handling", async () => {
    const server = createMcpHttpServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        osvaApiBaseUrl: "http://127.0.0.1:1",
        mcpPath: "/mcp",
        connectorAllowPrivateNetworks: false,
        stdioConnectorsEnabled: false,
      },
      authenticator: mockAuthenticator(sampleIdentity),
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
        connectorAllowPrivateNetworks: false,
        stdioConnectorsEnabled: false,
      },
      authenticator: mockAuthenticator(undefined),
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

  it("returns 503 when control-plane auth context is unavailable", async () => {
    const server = createMcpHttpServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        osvaApiBaseUrl: "http://127.0.0.1:1",
        mcpPath: "/mcp",
        connectorAllowPrivateNetworks: false,
        stdioConnectorsEnabled: false,
      },
      authenticator: {
        authenticate: async () => {
          throw new McpAuthenticationServiceUnavailableError();
        },
      },
      clients: noopClients,
    });

    const port = await server.listen();
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/mcp`, {
        method: "POST",
        headers: {
          authorization: "Bearer osva_ak_test",
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toEqual({ status: "service_unavailable" });
      expect(JSON.stringify(body)).not.toContain("osva_ak_test");
    } finally {
      await server.close();
    }
  });
});
