import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectorVersionId,
  McpConnectorExecutionConfig,
} from "@osva/contracts";
import { createPinnedOutboundFetch } from "@osva/outbound-network";

import { ManagedMcpClient, isMcpAdapterError } from "../src/index.js";
import {
  startFakeHttpMcpServer,
  type FakeHttpMcpServer,
} from "../src/testing/fake-http-mcp-server.js";

const VERSION_ID = "cv-http" as ConnectorVersionId;

describe("ManagedMcpClient outbound hardening", () => {
  const servers: FakeHttpMcpServer[] = [];
  const clients: ManagedMcpClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await Promise.all(servers.splice(0).map((server) => server.close()));
    vi.restoreAllMocks();
  });

  function executionConfig(endpointUrl: string): McpConnectorExecutionConfig {
    return {
      connectorVersionId: VERSION_ID,
      transport: "STREAMABLE_HTTP",
      transportConfig: { endpointUrl },
    };
  }

  function clientFor(endpointUrl: string, allowPrivateNetworks: boolean) {
    return new ManagedMcpClient({
      executionConfig: executionConfig(endpointUrl),
      secretResolver: {
        async resolve() {
          return "token";
        },
      },
      stdioConnectorsEnabled: false,
      pinnedFetch: createPinnedOutboundFetch({ allowPrivateNetworks }),
    });
  }

  it("denies discovery to loopback destinations by default", async () => {
    const server = await startFakeHttpMcpServer();
    servers.push(server);
    const client = clientFor(server.endpointUrl, false);
    clients.push(client);

    await expect(client.discoverTools()).rejects.toSatisfy(
      (error: unknown) =>
        isMcpAdapterError(error) && error.code === "CONNECTOR_UNAVAILABLE",
    );
  });

  it("denies execution to loopback destinations by default", async () => {
    const server = await startFakeHttpMcpServer();
    servers.push(server);
    const client = clientFor(server.endpointUrl, false);
    clients.push(client);

    await expect(
      client.invokeTool({
        executionConfig: executionConfig(server.endpointUrl),
        remoteToolName: "echo",
        input: {},
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isMcpAdapterError(error) && error.code === "CONNECTOR_UNAVAILABLE",
    );
  });

  it("denies mixed public+private DNS answers during discovery", async () => {
    const fetchImpl = createPinnedOutboundFetch({
      allowPrivateNetworks: false,
      lookup: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
    });
    const client = new ManagedMcpClient({
      executionConfig: executionConfig("https://public.example/mcp"),
      secretResolver: {
        async resolve() {
          return "token";
        },
      },
      stdioConnectorsEnabled: false,
      pinnedFetch: fetchImpl,
    });
    clients.push(client);

    await expect(client.discoverTools()).rejects.toSatisfy(
      (error: unknown) =>
        isMcpAdapterError(error) && error.code === "CONNECTOR_UNAVAILABLE",
    );
  });

  it("allows loopback when operator private-network opt-in is enabled", async () => {
    const server = await startFakeHttpMcpServer();
    servers.push(server);
    const client = clientFor(server.endpointUrl, true);
    clients.push(client);

    const tools = await client.discoverTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it("uses the shared pinned fetch path for discovery and execution", async () => {
    const server = await startFakeHttpMcpServer();
    servers.push(server);
    const baseFetch = createPinnedOutboundFetch({ allowPrivateNetworks: true });
    let pinnedFetchCalls = 0;
    const pinnedFetch = async (
      input: Parameters<typeof baseFetch>[0],
      init?: Parameters<typeof baseFetch>[1],
    ) => {
      pinnedFetchCalls += 1;
      return baseFetch(input, init);
    };
    const client = new ManagedMcpClient({
      executionConfig: executionConfig(server.endpointUrl),
      secretResolver: {
        async resolve() {
          return "token";
        },
      },
      stdioConnectorsEnabled: false,
      pinnedFetch,
    });
    clients.push(client);

    await client.discoverTools();
    const callsAfterDiscover = pinnedFetchCalls;
    expect(callsAfterDiscover).toBeGreaterThan(0);
    await client.invokeTool({
      executionConfig: executionConfig(server.endpointUrl),
      remoteToolName: "echo",
      input: { ok: true },
    });
    expect(pinnedFetchCalls).toBeGreaterThan(callsAfterDiscover);
  });
});
