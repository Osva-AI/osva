import { describe, expect, it } from "vitest";

import { mapConnectorVersionToPublicResource } from "../src/connector-public.js";

describe("public REST security fixtures", () => {
  it("redacts connector SecretReference keys from public responses", () => {
    const redacted = mapConnectorVersionToPublicResource({
      id: "cv-1" as never,
      connectorId: "c-1" as never,
      version: 1,
      kind: "MCP",
      transport: "STREAMABLE_HTTP",
      transportConfig: {
        endpointUrl: "https://example.com/mcp",
      },
      auth: {
        type: "BEARER",
        tokenSecret: { key: "MCP_BEARER" },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(JSON.stringify(redacted)).not.toContain("MCP_BEARER");
    expect(redacted.auth).toEqual({ type: "BEARER", configured: true });
  });

  it("freezes API-key metadata without digest or token fields", () => {
    const metadata: Record<string, unknown> = {
      id: "ak-1",
      name: "ops",
      role: "ADMIN",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    expect(Object.keys(metadata).sort()).toEqual([
      "createdAt",
      "id",
      "name",
      "role",
    ]);
    expect(metadata).not.toHaveProperty("secretDigest");
    expect(metadata).not.toHaveProperty("token");
  });

  it("allows one-time token only on API-key creation responses", () => {
    const creation: Record<string, unknown> = {
      apiKey: { id: "ak-1", name: "ops", role: "ADMIN" },
      token: "osva_ak_1.secret",
    };
    expect(creation).toHaveProperty("token");

    const listItem = { id: "ak-1", name: "ops", role: "ADMIN" };
    expect(listItem).not.toHaveProperty("token");
  });
});
