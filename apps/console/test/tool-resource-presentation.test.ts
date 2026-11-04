import { describe, expect, it } from "vitest";

import {
  formatConnectorVersionOption,
  formatToolTypeLabel,
  formatTransportLabel,
  summarizeToolVersion,
  toolVersionSelectLabel,
} from "../src/client/lib/tool-resource-presentation";

describe("tool-resource-presentation", () => {
  it("formats transport and tool types for display", () => {
    expect(formatTransportLabel("STREAMABLE_HTTP")).toBe("Streamable HTTP");
    expect(formatToolTypeLabel("INTERNAL")).toBe("Internal");
    expect(formatToolTypeLabel("MCP")).toBe("MCP");
  });

  it("summarizes MCP and internal tool versions", () => {
    expect(
      summarizeToolVersion({
        id: "tv-1",
        toolId: "t-1",
        version: 1,
        type: "INTERNAL",
        implementation: "echo",
        createdAt: "2026-01-01T00:00:00.000Z",
      }).typeLabel,
    ).toBe("Internal");
    expect(
      toolVersionSelectLabel({
        id: "tv-2",
        toolId: "t-1",
        version: 2,
        type: "MCP",
        implementation: "MCP_V1",
        mcp: {
          connectorVersionId: "cv-1",
          remoteToolName: "search",
          inputSchema: {},
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toContain("search");
  });

  it("builds human-readable connector version options", () => {
    expect(
      formatConnectorVersionOption({
        id: "cv-1",
        connectorId: "c-1",
        version: 1,
        kind: "MCP",
        transport: "STREAMABLE_HTTP",
        transportConfig: { endpointUrl: "https://mcp.example/mcp" },
        auth: { type: "BEARER", configured: true },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toContain("Streamable HTTP");
  });
});
