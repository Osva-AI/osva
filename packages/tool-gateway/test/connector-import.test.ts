import type { DiscoveredMcpTool, McpClientPool } from "@osva/contracts";
import {
  MemoryConnectorRepository,
  MemoryToolRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import { Workspace, createConnectorApplication } from "@osva/domain";
import { describe, expect, it, vi } from "vitest";

import { fakeControlPlaneScope } from "./test-scope.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const WORKSPACE_ID = "ws-1" as import("@osva/contracts").WorkspaceId;
const scope = fakeControlPlaneScope(WORKSPACE_ID);

describe("ConnectorApplication MCP import versioning", () => {
  it("reuses an existing ToolVersion when rediscovery returns the same schema", async () => {
    const discovered = [
      echoTool({ description: "Echoes tool input as text." }),
    ];
    const { application } = await createHarness(discovered);

    const connector = await application.createConnector.execute(scope, {
      workspaceId: WORKSPACE_ID,
      key: "fake-mcp",
      name: "Fake MCP",
    });
    const connectorVersion = await application.appendConnectorVersion.execute(
      scope,
      {
        connectorId: connector.id,
        kind: "MCP",
        transport: "STREAMABLE_HTTP",
        transportConfig: { endpointUrl: "http://127.0.0.1:9001" },
      },
    );

    const first = await application.importMcpTools.execute(scope, {
      connectorVersionId: connectorVersion.id,
      tools: [
        {
          remoteToolName: "echo",
          toolKey: "echo",
          toolName: "Echo",
        },
      ],
    });
    const second = await application.importMcpTools.execute(scope, {
      connectorVersionId: connectorVersion.id,
      tools: [
        {
          remoteToolName: "echo",
          toolKey: "echo",
          toolName: "Echo",
        },
      ],
    });

    expect(first[0]).toMatchObject({ createdNewToolVersion: true });
    expect(second[0]).toMatchObject({
      createdNewToolVersion: false,
      toolVersionId: first[0]!.toolVersionId,
      toolId: first[0]!.toolId,
    });
  });

  it("appends a new ToolVersion when rediscovery returns a changed schema", async () => {
    const initial = [echoTool({ description: "Echoes tool input as text." })];
    const { application, setDiscoveredTools } = await createHarness(initial);

    const connector = await application.createConnector.execute(scope, {
      workspaceId: WORKSPACE_ID,
      key: "fake-mcp",
      name: "Fake MCP",
    });
    const connectorVersion = await application.appendConnectorVersion.execute(
      scope,
      {
        connectorId: connector.id,
        kind: "MCP",
        transport: "STREAMABLE_HTTP",
        transportConfig: { endpointUrl: "http://127.0.0.1:9001" },
      },
    );

    const first = await application.importMcpTools.execute(scope, {
      connectorVersionId: connectorVersion.id,
      tools: [
        {
          remoteToolName: "echo",
          toolKey: "echo",
          toolName: "Echo",
        },
      ],
    });

    setDiscoveredTools([
      echoTool({
        description: "Echoes tool input as text.",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
        },
      }),
    ]);

    const second = await application.importMcpTools.execute(scope, {
      connectorVersionId: connectorVersion.id,
      tools: [
        {
          remoteToolName: "echo",
          toolKey: "echo",
          toolName: "Echo",
        },
      ],
    });

    expect(first[0]).toMatchObject({ createdNewToolVersion: true });
    expect(second[0]).toMatchObject({
      createdNewToolVersion: true,
      toolId: first[0]!.toolId,
    });
    expect(second[0]!.toolVersionId).not.toBe(first[0]!.toolVersionId);
  });
});

function echoTool(
  overrides: Partial<DiscoveredMcpTool> = {},
): DiscoveredMcpTool {
  return {
    remoteToolName: "echo",
    description: "Echoes tool input as text.",
    inputSchema: { type: "object", additionalProperties: true },
    ...overrides,
  };
}

async function createHarness(initialTools: readonly DiscoveredMcpTool[]) {
  const workspaces = new MemoryWorkspaceRepository();
  const connectors = new MemoryConnectorRepository();
  const tools = new MemoryToolRepository();
  await workspaces.save(
    Workspace.create({
      id: WORKSPACE_ID,
      name: "Workspace",
      createdAt: NOW,
    }),
  );

  let discoveredTools = initialTools;
  const mcpClientPool: McpClientPool = {
    discoverTools: vi.fn(async () => discoveredTools),
    invokeTool: vi.fn(),
    close: vi.fn(async () => undefined),
  };

  let counter = 0;
  const application = createConnectorApplication({
    connectors,
    tools,
    workspaces,
    mcpClientPool,
    mcpRuntimePolicy: { stdioConnectorsEnabled: true },
    clock: { now: () => NOW },
    ids: {
      createId() {
        counter += 1;
        return `generated-${String(counter)}`;
      },
    },
  });

  return {
    application,
    setDiscoveredTools(next: readonly DiscoveredMcpTool[]) {
      discoveredTools = next;
    },
  };
}
