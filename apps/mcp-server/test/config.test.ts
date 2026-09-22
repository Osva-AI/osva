import { describe, expect, it } from "vitest";

import { loadMcpServerConfig } from "../src/config.js";

describe("loadMcpServerConfig", () => {
  it("parses allowed MCP hosts from the environment", () => {
    const config = loadMcpServerConfig({
      OSVA_API_BASE_URL: "http://127.0.0.1:3000",
      OSVA_MCP_ALLOWED_HOSTS: "mcp.example.com, mcp.internal",
    });
    expect(config.allowedHosts).toEqual(["mcp.example.com", "mcp.internal"]);
  });
});
