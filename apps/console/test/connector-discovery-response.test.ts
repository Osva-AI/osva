import { describe, expect, it } from "vitest";

import {
  INVALID_MCP_DISCOVERY_TOOLS_MESSAGE,
  parseDiscoverConnectorToolsResponse,
} from "../src/client/lib/connector-discovery-response";

const connectorVersionId = "550e8400-e29b-41d4-a716-446655440000";

describe("parseDiscoverConnectorToolsResponse", () => {
  it("accepts a valid empty tools array", () => {
    const parsed = parseDiscoverConnectorToolsResponse({
      connectorVersionId,
      tools: [],
    });
    expect(parsed.tools).toEqual([]);
  });

  it("accepts a valid nonempty tools array", () => {
    const parsed = parseDiscoverConnectorToolsResponse({
      connectorVersionId,
      tools: [
        {
          remoteToolName: "echo",
          inputSchema: { type: "object" },
        },
      ],
    });
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0]?.remoteToolName).toBe("echo");
  });

  it.each([
    ["missing tools", { connectorVersionId }],
    ["null tools", { connectorVersionId, tools: null }],
    ["object tools", { connectorVersionId, tools: {} }],
    ["string tools", { connectorVersionId, tools: "invalid" }],
  ])("rejects %s", (_label, body) => {
    expect(() => parseDiscoverConnectorToolsResponse(body)).toThrow(
      INVALID_MCP_DISCOVERY_TOOLS_MESSAGE,
    );
  });
});
