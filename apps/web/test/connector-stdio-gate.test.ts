import { COMMUNITY_EDITION_ROLES } from "@osva/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { fetchJson, setTestAuthHeaders } from "./http-test-helpers.js";
import {
  authorizationHeader,
  createTestWebApplication,
  seedTestApiKey,
} from "./test-web.js";

const STDIO_SENTINEL = "DO_NOT_LEAK_STDIO_REF_71ae21";

describe("connector STDIO operator gate and ADMIN configuration", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  async function listen(stdioConnectorsEnabled: boolean) {
    const ctx = await createTestWebApplication({
      stdioConnectorsEnabled,
      secrets: { [STDIO_SENTINEL]: "stdio-value" },
    });
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    setTestAuthHeaders(ctx.testApiKey);
    return {
      origin: `http://127.0.0.1:${String(port)}`,
      ctx,
      adminAuth: authorizationHeader(ctx.testApiKey.plaintextToken),
    };
  }

  it("denies STDIO configuration and use when operator gate is off", async () => {
    const { origin, adminAuth, ctx } = await listen(false);

    const createVersion = await fetchJson(`${origin}/v1/connectors`, {
      method: "POST",
      headers: adminAuth,
      body: { key: "stdio", name: "Stdio" },
    });
    expect(createVersion.status).toBe(201);

    const deniedCreate = await fetchJson(
      `${origin}/v1/connectors/id-1/versions`,
      {
        method: "POST",
        headers: adminAuth,
        body: {
          kind: "MCP",
          transport: "STDIO",
          transportConfig: {
            command: "echo",
            args: ["x"],
            secretEnvironment: { TOKEN: { key: STDIO_SENTINEL } },
          },
        },
      },
    );
    expect(deniedCreate.status).toBe(403);

    const { Connector, ConnectorVersion } = await import("@osva/domain");
    const connector = Connector.create({
      id: "id-1" as import("@osva/contracts").ConnectorId,
      workspaceId: ctx.workspaceId,
      key: "stored-stdio",
      name: "Stored",
      createdAt: new Date("2026-01-15T12:00:00.000Z"),
      updatedAt: new Date("2026-01-15T12:00:00.000Z"),
    });
    await ctx.connectors.saveConnector(connector);
    const version = ConnectorVersion.create({
      id: "id-2" as import("@osva/contracts").ConnectorVersionId,
      connectorId: connector.id,
      version: 1,
      kind: "MCP",
      transport: "STDIO",
      transportConfig: { command: "echo", args: ["x"] },
      createdAt: new Date("2026-01-15T12:00:00.000Z"),
    });
    await ctx.connectors.saveConnectorVersion(version);

    const discover = await fetchJson(
      `${origin}/v1/connectors/id-1/versions/id-2/discover`,
      { method: "POST", headers: adminAuth },
    );
    expect(discover.status).toBe(403);
  });

  it("allows STDIO configuration for ADMIN when operator gate is on and denies EDITOR", async () => {
    const { origin, ctx, adminAuth } = await listen(true);
    const editor = await seedTestApiKey({
      apiKeys: ctx.apiKeys,
      workspaceId: ctx.workspaceId,
      role: COMMUNITY_EDITION_ROLES.EDITOR,
      apiKeyId: "ak-stdio-editor" as import("@osva/contracts").ApiKeyId,
    });
    const editorAuth = authorizationHeader(editor.plaintextToken);

    await fetchJson(`${origin}/v1/connectors`, {
      method: "POST",
      headers: adminAuth,
      body: { key: "stdio-admin", name: "Stdio Admin" },
    });

    const editorVersion = await fetchJson(
      `${origin}/v1/connectors/id-1/versions`,
      {
        method: "POST",
        headers: editorAuth,
        body: {
          kind: "MCP",
          transport: "STDIO",
          transportConfig: { command: "echo", args: ["x"] },
        },
      },
    );
    expect(editorVersion.status).toBe(403);

    const adminVersion = await fetchJson(
      `${origin}/v1/connectors/id-1/versions`,
      {
        method: "POST",
        headers: adminAuth,
        body: {
          kind: "MCP",
          transport: "STDIO",
          transportConfig: { command: "echo", args: ["x"] },
        },
      },
    );
    expect(adminVersion.status).toBe(201);
  });
});
