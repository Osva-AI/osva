import type {
  AgentId,
  ConnectorId,
  ConnectorVersionId,
  McpClientPool,
  RunAttemptId,
  RunId,
  ToolAuthorizationContext,
  ToolId,
  ToolPolicy,
  ToolVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { TOOL_ERROR_CODES } from "@osva-ai/contracts";
import {
  MemoryToolRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import {
  Connector,
  ConnectorVersion,
  Tool,
  ToolVersion,
  Workspace,
  createToolApplication,
} from "@osva/domain";
import { MemoryConnectorRepository } from "@osva/adapters-memory";
import { describe, expect, it, vi } from "vitest";

import {
  DefaultToolPolicy,
  ToolGateway,
  ToolGatewayError,
} from "../src/index.js";
import type { InternalToolImplementation } from "../src/internal/implementation.js";
import { invokeMcpToolVersion } from "../src/internal/mcp-tool-executor.js";
import * as registry from "../src/internal/registry.js";
import { fakeControlPlaneScope } from "./test-scope.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const WORKSPACE_ID = "ws-1" as WorkspaceId;
const OTHER_WORKSPACE_ID = "ws-2" as WorkspaceId;
const AGENT_ID = "agent-1" as AgentId;
const RUN_ID = "run-1" as RunId;
const RUN_ATTEMPT_ID = "run-attempt-1" as RunAttemptId;

class DenyingToolPolicy implements ToolPolicy {
  authorizeToolInvocation(context: ToolAuthorizationContext): void {
    void context;
    throw new ToolGatewayError(
      TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
      "Tool invocation was denied by policy.",
    );
  }
}

describe("ToolGateway", () => {
  it("invokes OSVA_ECHO_V1 with validated JSON", async () => {
    const { gateway, echoVersionId } = await createGateway();
    const output = await gateway.invoke({
      toolVersionId: echoVersionId,
      input: { value: { hello: "world" } },
      authorization: authContext("echo", echoVersionId),
    });

    expect(output).toEqual({ value: { hello: "world" } });
  });

  it("returns injected UTC time from OSVA_CLOCK_NOW_V1", async () => {
    const fixed = new Date("2026-03-01T09:30:00.000Z");
    const { gateway, clockVersionId } = await createGateway({
      clock: { now: () => fixed },
    });

    const output = await gateway.invoke({
      toolVersionId: clockVersionId,
      input: {},
      authorization: authContext("clock", clockVersionId),
    });

    expect(output).toEqual({ iso: fixed.toISOString() });
  });

  it("rejects malformed Echo input", async () => {
    const { gateway, echoVersionId } = await createGateway();
    await expect(
      gateway.invoke({
        toolVersionId: echoVersionId,
        input: { nope: true },
        authorization: authContext("echo", echoVersionId),
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.INVALID_TOOL_INPUT,
    });
  });

  it("calls ToolPolicy on every invocation", async () => {
    const { gateway, echoVersionId, policy } = await createGateway();
    await gateway.invoke({
      toolVersionId: echoVersionId,
      input: { value: 1 },
      authorization: authContext("echo", echoVersionId),
    });
    expect(policy.authorizeToolInvocation).toHaveBeenCalledOnce();
  });

  it("blocks execution when policy denies a bound tool", async () => {
    const tools = new MemoryToolRepository();
    const { echoVersionId } = await seedTools(tools);
    const gateway = new ToolGateway({
      tools,
      policy: new DenyingToolPolicy(),
    });

    await expect(
      gateway.invoke({
        toolVersionId: echoVersionId,
        input: { value: 1 },
        authorization: authContext("echo", echoVersionId),
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
    });
  });

  it("does not derive idempotencyKey from RunAttemptId", async () => {
    const { gateway, echoVersionId } = await createGateway();
    const supplied = "invoice:123:send";
    const output = await gateway.invoke({
      toolVersionId: echoVersionId,
      input: { value: "ok" },
      idempotencyKey: supplied,
      authorization: authContext("echo", echoVersionId),
    });

    expect(output).toEqual({ value: "ok" });
    expect(supplied).not.toBe(RUN_ATTEMPT_ID);
  });

  it("rejects non-JSON tool output at the gateway boundary", async () => {
    const tools = new MemoryToolRepository();
    const toolId = "tool-bad" as ToolId;
    const versionId = "tv-bad" as ToolVersionId;
    await tools.saveTool(
      Tool.create({
        id: toolId,
        workspaceId: WORKSPACE_ID,
        key: "bad",
        name: "Bad",
        createdAt: NOW,
      }),
    );
    await tools.saveToolVersion(
      ToolVersion.create({
        id: versionId,
        toolId,
        version: 1,
        type: "INTERNAL",
        implementation: "OSVA_ECHO_V1",
        createdAt: NOW,
      }),
    );

    const badImplementation: InternalToolImplementation = {
      invoke: () => ({ fn: () => undefined }) as never,
    };
    vi.spyOn(registry, "resolveInternalToolImplementation").mockReturnValue(
      badImplementation,
    );

    const gateway = new ToolGateway({
      tools,
      policy: { authorizeToolInvocation: () => undefined },
    });

    await expect(
      gateway.invoke({
        toolVersionId: versionId,
        input: { value: 1 },
        authorization: authContext("echo", versionId),
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.INVALID_TOOL_OUTPUT,
    });

    vi.restoreAllMocks();
  });

  it("rejects ToolVersion parent tools in another workspace", async () => {
    const tools = new MemoryToolRepository();
    const foreignToolId = "tool-foreign" as ToolId;
    const foreignVersionId = "tv-foreign" as ToolVersionId;
    await tools.saveTool(
      Tool.create({
        id: foreignToolId,
        workspaceId: OTHER_WORKSPACE_ID,
        key: "foreign-echo",
        name: "Foreign Echo",
        createdAt: NOW,
      }),
    );
    await tools.saveToolVersion(
      ToolVersion.create({
        id: foreignVersionId,
        toolId: foreignToolId,
        version: 1,
        type: "INTERNAL",
        implementation: "OSVA_ECHO_V1",
        createdAt: NOW,
      }),
    );

    const invokeSpy = vi.spyOn(registry, "resolveInternalToolImplementation");
    const gateway = new ToolGateway({
      tools,
      policy: new DefaultToolPolicy(),
    });

    await expect(
      gateway.invoke({
        toolVersionId: foreignVersionId,
        input: { value: 1 },
        authorization: authContext("echo", foreignVersionId),
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.TOOL_VERSION_NOT_FOUND,
      message: "ToolVersion was not found.",
    });
    expect(invokeSpy).not.toHaveBeenCalled();
    invokeSpy.mockRestore();
  });

  it("rejects mismatched request and authorization ToolVersion ids", async () => {
    const { gateway, echoVersionId } = await createGateway();
    const invokeSpy = vi.spyOn(registry, "resolveInternalToolImplementation");

    await expect(
      gateway.invoke({
        toolVersionId: echoVersionId,
        input: { value: 1 },
        authorization: authContext("echo", "tv-other" as ToolVersionId),
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
    });
    expect(invokeSpy).not.toHaveBeenCalled();
    invokeSpy.mockRestore();
  });

  it("rejects MCP tools whose ConnectorVersion belongs to another workspace", async () => {
    const tools = new MemoryToolRepository();
    const connectors = new MemoryConnectorRepository();
    const connectorId = "conn-b" as ConnectorId;
    const connectorVersionId = "cv-b" as ConnectorVersionId;
    const mcpToolId = "tool-mcp-a" as ToolId;
    const mcpVersionId = "tv-mcp-a" as ToolVersionId;

    await tools.saveTool(
      Tool.create({
        id: mcpToolId,
        workspaceId: WORKSPACE_ID,
        key: "mcp-echo",
        name: "MCP Echo",
        createdAt: NOW,
      }),
    );
    await connectors.saveConnector(
      Connector.create({
        id: connectorId,
        workspaceId: OTHER_WORKSPACE_ID,
        key: "foreign-conn",
        name: "Foreign Connector",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    await connectors.saveConnectorVersion(
      ConnectorVersion.create({
        id: connectorVersionId,
        connectorId,
        version: 1,
        kind: "MCP",
        transport: "STREAMABLE_HTTP",
        transportConfig: {
          endpointUrl: "http://127.0.0.1:9/mcp",
        },
        createdAt: NOW,
      }),
    );
    await tools.saveToolVersion(
      ToolVersion.create({
        id: mcpVersionId,
        toolId: mcpToolId,
        version: 1,
        type: "MCP",
        implementation: "MCP_V1",
        mcp: {
          connectorVersionId,
          remoteToolName: "echo",
          inputSchema: { type: "object" },
        },
        createdAt: NOW,
      }),
    );

    const mcpClientPool: McpClientPool = {
      discoverTools: vi.fn(),
      invokeTool: vi.fn(async () => ({ isError: false, output: { ok: true } })),
      close: vi.fn(async () => undefined),
    };

    const gateway = new ToolGateway({
      tools,
      connectors,
      mcpClientPool,
      policy: new DefaultToolPolicy(),
    });

    await expect(
      gateway.invoke({
        toolVersionId: mcpVersionId,
        input: { hello: "world" },
        authorization: authContext("echo", mcpVersionId),
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.TOOL_IMPLEMENTATION_NOT_FOUND,
      message: "ConnectorVersion was not found.",
    });
    expect(mcpClientPool.invokeTool).not.toHaveBeenCalled();
  });

  it("fails safely when ConnectorVersion is missing for an MCP tool", async () => {
    const tools = new MemoryToolRepository();
    const connectors = new MemoryConnectorRepository();
    const mcpToolId = "tool-mcp-missing" as ToolId;
    const mcpVersionId = "tv-mcp-missing" as ToolVersionId;

    await tools.saveTool(
      Tool.create({
        id: mcpToolId,
        workspaceId: WORKSPACE_ID,
        key: "mcp-missing",
        name: "MCP Missing",
        createdAt: NOW,
      }),
    );
    await tools.saveToolVersion(
      ToolVersion.create({
        id: mcpVersionId,
        toolId: mcpToolId,
        version: 1,
        type: "MCP",
        implementation: "MCP_V1",
        mcp: {
          connectorVersionId: "cv-missing" as ConnectorVersionId,
          remoteToolName: "echo",
          inputSchema: { type: "object" },
        },
        createdAt: NOW,
      }),
    );

    const mcpClientPool: McpClientPool = {
      discoverTools: vi.fn(),
      invokeTool: vi.fn(),
      close: vi.fn(async () => undefined),
    };

    await expect(
      invokeMcpToolVersion(
        { connectors, mcpClientPool },
        (await tools.findToolVersionById(mcpVersionId))!,
        {
          toolVersionId: mcpVersionId,
          input: {},
          authorization: authContext("echo", mcpVersionId),
        },
      ),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.TOOL_IMPLEMENTATION_NOT_FOUND,
    });
    expect(mcpClientPool.invokeTool).not.toHaveBeenCalled();
  });
});

async function createGateway(options?: { readonly clock?: { now(): Date } }) {
  const tools = new MemoryToolRepository();
  const seeded = await seedTools(tools);
  const policy = {
    authorizeToolInvocation: vi.fn(),
  };

  const gateway = new ToolGateway({
    tools,
    policy,
    clock: options?.clock,
  });

  return { gateway, policy, ...seeded };
}

async function seedTools(tools: MemoryToolRepository) {
  const workspaces = new MemoryWorkspaceRepository();
  await workspaces.save(
    Workspace.create({
      id: WORKSPACE_ID,
      name: "Workspace",
      createdAt: NOW,
    }),
  );

  let counter = 0;
  const application = createToolApplication({
    tools,
    workspaces,
    clock: { now: () => NOW },
    ids: {
      createId() {
        counter += 1;
        return `generated-${String(counter)}`;
      },
    },
  });

  const scope = fakeControlPlaneScope(WORKSPACE_ID);
  const echoTool = await application.createTool.execute(scope, {
    workspaceId: WORKSPACE_ID,
    key: "echo",
    name: "Echo",
  });
  const clockTool = await application.createTool.execute(scope, {
    workspaceId: WORKSPACE_ID,
    key: "clock",
    name: "Clock",
  });
  const echoVersion = await application.appendToolVersion.execute(scope, {
    toolId: echoTool.id,
    type: "INTERNAL",
    implementation: "OSVA_ECHO_V1",
  });
  const clockVersion = await application.appendToolVersion.execute(scope, {
    toolId: clockTool.id,
    type: "INTERNAL",
    implementation: "OSVA_CLOCK_NOW_V1",
  });

  return {
    echoVersionId: echoVersion.id,
    clockVersionId: clockVersion.id,
  };
}

function authContext(
  bindingName: string,
  toolVersionId: ToolVersionId,
): ToolAuthorizationContext {
  return {
    workspaceId: WORKSPACE_ID,
    agentId: AGENT_ID,
    runId: RUN_ID,
    runAttemptId: RUN_ATTEMPT_ID,
    bindingName,
    toolVersionId,
  };
}
