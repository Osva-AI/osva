import { describe, expect, it } from "vitest";

import {
  OSVA_MCP_TOOL_NAMES,
  buildOsvaMcpResourceUri,
  parseOsvaMcpResourceUri,
} from "../src/mcp-server.js";
import {
  listStdioEnvironmentConflicts,
  validateStdioTransportEnvironment,
} from "../src/stdio-transport.js";
import { osvaMcpAgentRunV1InputSchema } from "../src/schemas/mcp-server.js";

describe("mcp-server contracts", () => {
  it("exposes stable V1 tool names", () => {
    expect(OSVA_MCP_TOOL_NAMES.AGENT_RUN_V1).toBe("osva_agent_run_v1");
    expect(OSVA_MCP_TOOL_NAMES.RUN_GET_V1).toBe("osva_run_get_v1");
    expect(OSVA_MCP_TOOL_NAMES.WORKFLOW_RUN_V1).toBe("osva_workflow_run_v1");
    expect(OSVA_MCP_TOOL_NAMES.WORKFLOW_RUN_GET_V1).toBe(
      "osva_workflow_run_get_v1",
    );
  });

  it("parses resource URIs", () => {
    expect(
      parseOsvaMcpResourceUri(buildOsvaMcpResourceUri(["agents"])),
    ).toEqual({ kind: "agents" });
    expect(
      parseOsvaMcpResourceUri(
        buildOsvaMcpResourceUri(["agents", "agent-1", "versions"]),
      ),
    ).toEqual({ kind: "agent-versions", agentId: "agent-1" });
    expect(
      parseOsvaMcpResourceUri(
        buildOsvaMcpResourceUri(["workflow-runs", "wr-1"]),
      ),
    ).toEqual({ kind: "workflow-run", workflowRunId: "wr-1" });
  });

  it("rejects workspaceId in MCP tool input", () => {
    const parsed = osvaMcpAgentRunV1InputSchema.safeParse({
      agentId: "agent-1",
      agentVersionId: "av-1",
      input: {},
      workspaceId: "ws-other",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("stdio transport environment", () => {
  it("rejects duplicate environment and secretEnvironment keys", () => {
    expect(
      listStdioEnvironmentConflicts({
        environment: { TOKEN: "plain" },
        secretEnvironment: { TOKEN: { key: "TOKEN" } },
      }),
    ).toEqual(["TOKEN"]);

    expect(() =>
      validateStdioTransportEnvironment({
        environment: { TOKEN: "plain" },
        secretEnvironment: { TOKEN: { key: "TOKEN" } },
      }),
    ).toThrow();
  });
});
