import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectorVersionId,
  McpConnectorExecutionConfig,
} from "@osva/contracts";

import { ManagedMcpClient, isMcpAdapterError } from "../src/index.js";
import { createPinnedOutboundFetch } from "@osva/outbound-network";

const stdioCtor = vi.hoisted(() => vi.fn());

vi.mock("@modelcontextprotocol/client/stdio", () => ({
  StdioClientTransport: class {
    constructor(...args: unknown[]) {
      stdioCtor(...args);
    }
  },
}));

const STDIO_SCRIPT = fileURLToPath(
  new URL("./fake-stdio-mcp-server.mjs", import.meta.url),
);

describe("ManagedMcpClient STDIO operator gate", () => {
  afterEach(() => {
    stdioCtor.mockClear();
  });

  const executionConfig: McpConnectorExecutionConfig = {
    connectorVersionId: "cv-stdio" as ConnectorVersionId,
    transport: "STDIO",
    transportConfig: {
      command: process.execPath,
      args: [STDIO_SCRIPT],
      secretEnvironment: {
        TOKEN: { key: "SHOULD_NOT_RESOLVE" },
      },
    },
  };

  it("does not spawn or resolve secrets when STDIO is disabled", async () => {
    const resolve = vi.fn(async () => "secret");
    const client = new ManagedMcpClient({
      executionConfig,
      secretResolver: { resolve },
      stdioConnectorsEnabled: false,
      pinnedFetch: createPinnedOutboundFetch({ allowPrivateNetworks: true }),
    });

    await expect(client.discoverTools()).rejects.toSatisfy(
      (error: unknown) =>
        isMcpAdapterError(error) && error.code === "CONNECTOR_UNAVAILABLE",
    );
    await expect(
      client.invokeTool({
        executionConfig,
        remoteToolName: "echo",
        input: {},
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isMcpAdapterError(error) && error.code === "CONNECTOR_UNAVAILABLE",
    );

    expect(stdioCtor).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    await client.close();
  });
});
