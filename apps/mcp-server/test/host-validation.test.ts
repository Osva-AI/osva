import http from "node:http";

import { describe, expect, it } from "vitest";

function postMcpWithHost(
  port: number,
  hostHeader: string,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          Host: hostHeader,
          authorization: "Bearer token",
          "content-type": "application/json",
        },
      },
      (response) => {
        response.resume();
        resolve({ status: response.statusCode ?? 0 });
      },
    );
    request.on("error", reject);
    request.write("{}");
    request.end();
  });
}

import { createMcpHttpServer } from "../src/http-server.js";
import {
  createMcpHostHeaderValidator,
  parseMcpAllowedHosts,
} from "../src/host-validation.js";
import type {
  AuthenticatedMcpIdentity,
  McpAuthenticator,
} from "../src/auth.js";
import type { ApiKeyId, WorkspaceId } from "@osva/contracts";
import type { OsvaClientFactory } from "../src/osva-client.js";

const noopClients: OsvaClientFactory = {
  forPrincipal() {
    throw new Error("not implemented");
  },
};

const sampleIdentity: AuthenticatedMcpIdentity = {
  principal: {
    subjectId: "ak-a" as ApiKeyId,
    workspaceId: "ws-a" as WorkspaceId,
    role: "ADMIN",
  },
  bearerCredential: "token",
};

function mockAuthenticator(
  identity?: AuthenticatedMcpIdentity,
): McpAuthenticator {
  return {
    authenticate: async () => identity,
  };
}

describe("parseMcpAllowedHosts", () => {
  it("rejects wildcards", () => {
    expect(() => parseMcpAllowedHosts("*.example.com")).toThrow(/wildcards/);
  });

  it("parses explicit hostnames", () => {
    expect(parseMcpAllowedHosts("mcp.example.com, mcp.internal")).toEqual([
      "mcp.example.com",
      "mcp.internal",
    ]);
  });
});

describe("MCP host header validation", () => {
  it("allows localhost by default", async () => {
    const server = createMcpHttpServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        osvaApiBaseUrl: "http://127.0.0.1:1",
        mcpPath: "/mcp",
        allowedHosts: [],
        connectorAllowPrivateNetworks: false,
        stdioConnectorsEnabled: false,
      },
      authenticator: mockAuthenticator(sampleIdentity),
      clients: noopClients,
    });

    const port = await server.listen();
    try {
      const response = await postMcpWithHost(port, "127.0.0.1");
      expect(response.status).not.toBe(403);
    } finally {
      await server.close();
    }
  });

  it("allows configured production hostnames", async () => {
    const server = createMcpHttpServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        osvaApiBaseUrl: "http://127.0.0.1:1",
        mcpPath: "/mcp",
        allowedHosts: ["mcp.example.com"],
        connectorAllowPrivateNetworks: false,
        stdioConnectorsEnabled: false,
      },
      authenticator: mockAuthenticator(sampleIdentity),
      clients: noopClients,
    });

    const port = await server.listen();
    try {
      const response = await postMcpWithHost(port, "mcp.example.com");
      expect(response.status).not.toBe(403);
    } finally {
      await server.close();
    }
  });

  it("rejects disallowed hostnames", async () => {
    const server = createMcpHttpServer({
      config: {
        host: "127.0.0.1",
        port: 0,
        osvaApiBaseUrl: "http://127.0.0.1:1",
        mcpPath: "/mcp",
        allowedHosts: ["mcp.example.com"],
        connectorAllowPrivateNetworks: false,
        stdioConnectorsEnabled: false,
      },
      authenticator: mockAuthenticator(sampleIdentity),
      clients: noopClients,
    });

    const port = await server.listen();
    try {
      const response = await postMcpWithHost(port, "evil.example.com");
      expect(response.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("does not apply host validation to /health", async () => {
    const validateHost = createMcpHostHeaderValidator(["mcp.example.com"]);
    const server = http.createServer((request, response) => {
      const path = request.url?.split("?")[0] ?? "";
      if (path === "/health") {
        response.writeHead(200);
        response.end("ok");
        return;
      }
      if (!validateHost(request, response)) {
        return;
      }
      response.writeHead(404);
      response.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("bind failed");
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:${String(address.port)}/health`,
        {
          headers: { host: "evil.example.com" },
        },
      );
      expect(response.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
