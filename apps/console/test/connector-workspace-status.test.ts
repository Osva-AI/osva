import { describe, expect, it } from "vitest";

import { resolveCatalogWorkspaceIntegration } from "../src/client/lib/connector-workspace-status";

describe("connector workspace status", () => {
  it("does not link custom workspace keys to catalog entries", () => {
    const customKey = resolveCatalogWorkspaceIntegration({
      catalogConnectorKey: "osva-connector-github",
      workspaceConnectors: [
        {
          id: "c-custom",
          workspaceId: "w1",
          key: "my-github-integration",
          name: "GitHub",
          createdAt: "",
          updatedAt: "",
        },
      ],
      connectorVersionsByConnectorId: new Map([["c-custom", [{ id: "cv1" }]]]),
      mcpToolVersions: [],
    });
    expect(customKey.status).toBe("catalog-only");
  });

  it("never reports connected or live provider health", () => {
    const resolved = resolveCatalogWorkspaceIntegration({
      catalogConnectorKey: "osva-connector-github",
      workspaceConnectors: [
        {
          id: "c1",
          workspaceId: "w1",
          key: "osva-connector-github",
          name: "GitHub",
          createdAt: "",
          updatedAt: "",
        },
      ],
      connectorVersionsByConnectorId: new Map([["c1", [{ id: "cv1" }]]]),
      mcpToolVersions: [
        {
          id: "tv1",
          toolId: "t1",
          version: 1,
          type: "MCP",
          implementation: "MCP_V1",
          mcp: {
            connectorVersionId: "cv1",
            remoteToolName: "github.repository.get",
            inputSchema: {},
          },
          createdAt: "",
        },
      ],
    });
    expect(resolved.status).toBe("tools-imported");
    expect(resolved.importedMcpToolVersionIds).toEqual(["tv1"]);
    expect(resolved.status).not.toBe("connected");
  });
});
