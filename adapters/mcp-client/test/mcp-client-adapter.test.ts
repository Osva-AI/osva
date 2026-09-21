import { fileURLToPath } from "node:url";
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ConnectorAuthConfig,
  ConnectorId,
  ConnectorVersionId,
  McpConnectorExecutionConfig,
  SecretReference,
  SecretResolver,
} from "@osva/contracts";
import { createPinnedOutboundFetch } from "@osva/outbound-network";

import { mapMcpFailure } from "../src/error-mapping.js";
import {
  isMcpAdapterError,
  ManagedMcpClient,
  createMcpClientPool,
} from "../src/index.js";
import {
  FAKE_MCP_BEARER_TOKEN,
  startFakeHttpMcpServer,
  type FakeHttpMcpServer,
} from "../src/testing/fake-http-mcp-server.js";

const CONNECTOR_ID = "connector-1" as ConnectorId;
const VERSION_ID = "connector-version-1" as ConnectorVersionId;
const NOW = "2026-01-15T12:00:00.000Z";
const STDIO_SCRIPT = fileURLToPath(
  new URL("./fake-stdio-mcp-server.mjs", import.meta.url),
);

const TEST_PINNED_FETCH = createPinnedOutboundFetch({
  allowPrivateNetworks: true,
});

function testPoolOptions(secretResolver: SecretResolver) {
  return {
    secretResolver,
    stdioConnectorsEnabled: true,
    allowPrivateNetworks: true,
    pinnedFetch: TEST_PINNED_FETCH,
  };
}

function testClientOptions(
  executionConfig: McpConnectorExecutionConfig,
  secretResolver: SecretResolver,
) {
  return {
    executionConfig,
    secretResolver,
    stdioConnectorsEnabled: true,
    pinnedFetch: TEST_PINNED_FETCH,
  };
}

describe("ManagedMcpClient", () => {
  const httpServers: FakeHttpMcpServer[] = [];
  const clients: ManagedMcpClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await Promise.all(httpServers.splice(0).map((server) => server.close()));
  });

  describe("HTTP transport", () => {
    it("discovers remote MCP tools", async () => {
      const server = await startFakeHttpMcpServer();
      httpServers.push(server);
      const client = createHttpClient(server.endpointUrl);
      clients.push(client);

      const tools = await client.discoverTools();

      expect(tools.map((tool) => tool.remoteToolName).sort()).toEqual([
        "echo",
        "error",
        "hang",
        "malformed",
        "structured",
      ]);
      expect(
        tools.find((tool) => tool.remoteToolName === "echo"),
      ).toMatchObject({
        description: "Echoes tool input as text.",
        inputSchema: { type: "object" },
      });
    });

    it("invokes echo and structured tools", async () => {
      const server = await startFakeHttpMcpServer();
      httpServers.push(server);
      const client = createHttpClient(server.endpointUrl);
      clients.push(client);

      const echo = await client.invokeTool({
        executionConfig: toExecutionConfig(httpVersion(server.endpointUrl)),
        remoteToolName: "echo",
        input: { hello: "world" },
      });
      const structured = await client.invokeTool({
        executionConfig: toExecutionConfig(httpVersion(server.endpointUrl)),
        remoteToolName: "structured",
        input: { count: 2 },
      });

      expect(echo).toEqual({
        output: JSON.stringify({ hello: "world" }),
        isError: false,
      });
      expect(structured).toEqual({
        output: { kind: "structured", value: { count: 2 } },
        isError: false,
      });
      expect(server.toolCallCount).toBe(2);
    });

    it("fails authentication when bearer token is missing or invalid", async () => {
      const server = await startFakeHttpMcpServer({ requireAuth: true });
      httpServers.push(server);

      const missingAuth = createHttpClient(server.endpointUrl);
      clients.push(missingAuth);
      await expect(missingAuth.discoverTools()).rejects.toSatisfy((error) =>
        isAuthFailure(error),
      );

      const wrongAuth = new ManagedMcpClient(
        testClientOptions(
          toExecutionConfig(
            httpVersion(server.endpointUrl, {
              type: "BEARER",
              tokenSecret: { key: "BAD_TOKEN" },
            }),
          ),
          testSecretResolver({
            BAD_TOKEN: "not-the-right-token",
          }),
        ),
      );
      clients.push(wrongAuth);
      await expect(wrongAuth.discoverTools()).rejects.toSatisfy((error) =>
        isAuthFailure(error),
      );
    });

    it("connects with bearer auth when token is valid", async () => {
      const server = await startFakeHttpMcpServer({ requireAuth: true });
      httpServers.push(server);
      const client = createHttpClient(server.endpointUrl, {
        type: "BEARER",
        tokenSecret: { key: "MCP_TEST_TOKEN" },
      });
      clients.push(client);

      const tools = await client.discoverTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    it("returns MCP tool error results without throwing", async () => {
      const server = await startFakeHttpMcpServer();
      httpServers.push(server);
      const client = createHttpClient(server.endpointUrl);
      clients.push(client);

      const result = await client.invokeTool({
        executionConfig: toExecutionConfig(httpVersion(server.endpointUrl)),
        remoteToolName: "error",
        input: {},
      });

      expect(result.isError).toBe(true);
      expect(result.output).toBe("intentional fake MCP tool error");
    });

    it("rejects malformed MCP tool responses", async () => {
      const server = await startFakeHttpMcpServer();
      httpServers.push(server);
      const client = createHttpClient(server.endpointUrl);
      clients.push(client);

      await expect(
        client.invokeTool({
          executionConfig: toExecutionConfig(httpVersion(server.endpointUrl)),
          remoteToolName: "malformed",
          input: {},
        }),
      ).rejects.toMatchObject({
        code: "MCP_INVALID_RESPONSE",
      });
    });

    it("rejects operations after close", async () => {
      const server = await startFakeHttpMcpServer();
      httpServers.push(server);
      const client = createHttpClient(server.endpointUrl);
      await client.close();

      await expect(client.discoverTools()).rejects.toMatchObject({
        code: "CONNECTOR_UNAVAILABLE",
      });
    });
  });

  describe("STDIO transport", () => {
    it("discovers and invokes tools over stdio", async () => {
      const client = createStdioClient();
      clients.push(client);

      const tools = await client.discoverTools();
      expect(tools.map((tool) => tool.remoteToolName)).toContain("echo");

      const result = await client.invokeTool({
        executionConfig: toExecutionConfig(stdioVersion()),
        remoteToolName: "echo",
        input: { via: "stdio" },
      });

      expect(result).toEqual({
        output: JSON.stringify({ via: "stdio" }),
        isError: false,
      });
    });

    it("reuses the same client connection across invocations", async () => {
      const client = createStdioClient();
      clients.push(client);
      const version = stdioVersion();

      await client.invokeTool({
        executionConfig: toExecutionConfig(version),
        remoteToolName: "echo",
        input: { call: 1 },
      });
      await client.invokeTool({
        executionConfig: toExecutionConfig(version),
        remoteToolName: "echo",
        input: { call: 2 },
      });

      const structured = await client.invokeTool({
        executionConfig: toExecutionConfig(version),
        remoteToolName: "structured",
        input: { call: 3 },
      });
      expect(structured.output).toEqual({
        kind: "structured",
        value: { call: 3 },
      });
    });

    it("rejects discovery when the abort signal is already aborted", async () => {
      const client = createStdioClient();
      clients.push(client);
      const controller = new AbortController();
      controller.abort();

      await expect(
        client.discoverTools({ signal: controller.signal }),
      ).rejects.toMatchObject({
        code: "CONNECTOR_CANCELLED",
      });
    });

    it("cancels an in-flight hang call without killing the shared stdio process", async () => {
      const client = createStdioClient();
      clients.push(client);
      const version = stdioVersion();
      const controller = new AbortController();

      const hangPromise = client.invokeTool({
        executionConfig: toExecutionConfig(version),
        remoteToolName: "hang",
        input: {},
        signal: controller.signal,
      });

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
      controller.abort();

      await expect(hangPromise).rejects.toMatchObject({
        code: "CONNECTOR_CANCELLED",
      });

      const result = await client.invokeTool({
        executionConfig: toExecutionConfig(version),
        remoteToolName: "echo",
        input: { after: "cancel" },
      });
      expect(result).toEqual({
        output: JSON.stringify({ after: "cancel" }),
        isError: false,
      });
    });

    it("times out an in-flight hang call without killing the shared stdio process", async () => {
      const client = createStdioClient();
      clients.push(client);
      const version = stdioVersion();

      await expect(
        client.invokeTool({
          executionConfig: toExecutionConfig(version),
          remoteToolName: "hang",
          input: {},
          timeoutMs: 200,
        }),
      ).rejects.toMatchObject({
        code: "CONNECTOR_TIMEOUT",
        retryable: true,
      });

      const result = await client.invokeTool({
        executionConfig: toExecutionConfig(version),
        remoteToolName: "echo",
        input: { after: "timeout" },
      });
      expect(result).toEqual({
        output: JSON.stringify({ after: "timeout" }),
        isError: false,
      });
    });
  });
});

describe("MCP adapter error mapping", () => {
  it("maps abort signals to CONNECTOR_CANCELLED", () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => mapMcpFailure(new Error("boom"), controller.signal)).toThrow(
      expect.objectContaining({
        code: "CONNECTOR_CANCELLED",
      }),
    );
  });

  it("maps SDK request timeouts to CONNECTOR_TIMEOUT", () => {
    expect(() =>
      mapMcpFailure(new SdkError(SdkErrorCode.RequestTimeout, "timed out")),
    ).toThrow(
      expect.objectContaining({
        code: "CONNECTOR_TIMEOUT",
        retryable: true,
      }),
    );
  });
});

describe("OsvaMcpClientPool", () => {
  const httpServers: FakeHttpMcpServer[] = [];

  afterEach(async () => {
    await Promise.all(httpServers.splice(0).map((server) => server.close()));
  });

  it("reuses managed clients per ConnectorVersion id", async () => {
    const server = await startFakeHttpMcpServer();
    httpServers.push(server);
    const pool = createMcpClientPool(testPoolOptions(testSecretResolver({})));
    const version = httpVersion(server.endpointUrl);

    await pool.discoverTools(toExecutionConfig(version));
    server.resetToolCallCount();
    await pool.invokeTool({
      executionConfig: toExecutionConfig(version),
      remoteToolName: "echo",
      input: { pooled: true },
    });
    await pool.invokeTool({
      executionConfig: toExecutionConfig(version),
      remoteToolName: "echo",
      input: { pooled: true },
    });

    expect(server.toolCallCount).toBe(2);
    await pool.close();
  });

  it("closes all pooled clients cleanly", async () => {
    const server = await startFakeHttpMcpServer();
    httpServers.push(server);
    const pool = createMcpClientPool(testPoolOptions(testSecretResolver({})));
    const version = httpVersion(server.endpointUrl);

    await pool.discoverTools(toExecutionConfig(version));
    await expect(pool.close()).resolves.toBeUndefined();
    await expect(pool.close()).resolves.toBeUndefined();
  });
});

function createHttpClient(
  endpointUrl: string,
  auth?: ConnectorAuthConfig,
): ManagedMcpClient {
  return new ManagedMcpClient(
    testClientOptions(
      toExecutionConfig(httpVersion(endpointUrl, auth)),
      testSecretResolver({
        MCP_TEST_TOKEN: FAKE_MCP_BEARER_TOKEN,
      }),
    ),
  );
}

function createStdioClient(): ManagedMcpClient {
  return new ManagedMcpClient(
    testClientOptions(
      toExecutionConfig(stdioVersion()),
      testSecretResolver({}),
    ),
  );
}

function httpVersion(
  endpointUrl: string,
  auth?: ConnectorAuthConfig,
): {
  readonly id: ConnectorVersionId;
  readonly connectorId: ConnectorId;
  readonly version: number;
  readonly kind: "MCP";
  readonly transport: "STREAMABLE_HTTP";
  readonly transportConfig: { readonly endpointUrl: string };
  readonly auth?: ConnectorAuthConfig;
  readonly createdAt: string;
} {
  return {
    id: VERSION_ID,
    connectorId: CONNECTOR_ID,
    version: 1,
    kind: "MCP",
    transport: "STREAMABLE_HTTP",
    transportConfig: { endpointUrl },
    auth,
    createdAt: NOW,
  };
}

function toExecutionConfig(input: {
  readonly id: ConnectorVersionId;
  readonly transport: McpConnectorExecutionConfig["transport"];
  readonly transportConfig: McpConnectorExecutionConfig["transportConfig"];
  readonly auth?: ConnectorAuthConfig;
}): McpConnectorExecutionConfig {
  return {
    connectorVersionId: input.id,
    transport: input.transport,
    transportConfig: input.transportConfig,
    auth: input.auth,
  };
}

function isAuthFailure(error: unknown): boolean {
  if (isMcpAdapterError(error)) {
    return (
      error.code === "CONNECTOR_AUTHENTICATION_FAILED" ||
      error.code === "MCP_PROTOCOL_ERROR"
    );
  }

  return error instanceof Error;
}

function testSecretResolver(
  secrets: Readonly<Record<string, string>>,
): SecretResolver {
  return {
    async resolve(reference: SecretReference) {
      const value = secrets[reference.key];
      if (value === undefined) {
        throw new Error(`Secret '${reference.key}' was not found.`);
      }
      return value;
    },
  };
}

function stdioVersion(): {
  readonly id: ConnectorVersionId;
  readonly connectorId: ConnectorId;
  readonly version: number;
  readonly kind: "MCP";
  readonly transport: "STDIO";
  readonly transportConfig: {
    readonly command: string;
    readonly args: readonly string[];
  };
  readonly createdAt: string;
} {
  return {
    id: "connector-version-stdio" as ConnectorVersionId,
    connectorId: CONNECTOR_ID,
    version: 1,
    kind: "MCP",
    transport: "STDIO",
    transportConfig: {
      command: process.execPath,
      args: [STDIO_SCRIPT],
    },
    createdAt: NOW,
  };
}
