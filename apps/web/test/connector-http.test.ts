import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { fetchJson, setTestAuthHeaders } from "./http-test-helpers.js";
import { TEST_NOW, createTestWebApplication } from "./test-web.js";
import {
  FAKE_MCP_BEARER_TOKEN,
  startFakeHttpMcpServer,
  type FakeHttpMcpServer,
} from "@osva/adapters-mcp-client/testing";

const WORKSPACE_ID = "ws-1" as WorkspaceId;

describe("Connector Registry HTTP API", () => {
  const servers: import("node:http").Server[] = [];
  const fakeMcpServers: FakeHttpMcpServer[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
    await Promise.all(fakeMcpServers.splice(0).map((server) => server.close()));
  });

  it("creates, reads, lists, and renames Connectors", async () => {
    const { origin } = await listen();
    const created = await fetchJson(`${origin}/v1/connectors`, {
      method: "POST",
      body: {
        key: "fake-mcp",
        name: "Fake MCP",
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: "id-1",
      key: "fake-mcp",
      name: "Fake MCP",
      createdAt: TEST_NOW.toISOString(),
    });

    const loaded = await fetchJson(`${origin}/v1/connectors/id-1`);
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual(created.body);

    const listed = await fetchJson(`${origin}/v1/connectors`);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ connectors: [created.body] });

    const updated = await fetchJson(`${origin}/v1/connectors/id-1`, {
      method: "PATCH",
      body: { name: "Renamed Fake MCP" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      key: "fake-mcp",
      name: "Renamed Fake MCP",
    });
  });

  it("appends immutable ConnectorVersions", async () => {
    const fakeMcp = await startFakeHttpMcpServer();
    fakeMcpServers.push(fakeMcp);
    const { origin } = await listen();
    await fetchJson(`${origin}/v1/connectors`, {
      method: "POST",
      body: {
        key: "fake-mcp",
        name: "Fake MCP",
      },
    });

    const v1 = await fetchJson(`${origin}/v1/connectors/id-1/versions`, {
      method: "POST",
      body: {
        kind: "MCP",
        transport: "STREAMABLE_HTTP",
        transportConfig: { endpointUrl: fakeMcp.endpointUrl },
      },
    });
    expect(v1.status).toBe(201);
    expect(v1.body).toMatchObject({
      connectorId: "id-1",
      version: 1,
      kind: "MCP",
      transport: "STREAMABLE_HTTP",
    });

    const listed = await fetchJson(`${origin}/v1/connectors/id-1/versions`);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ versions: [v1.body] });

    const loaded = await fetchJson(
      `${origin}/v1/connectors/id-1/versions/id-2`,
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual(v1.body);
  });

  it("discovers MCP tools for a ConnectorVersion", async () => {
    const fakeMcp = await startFakeHttpMcpServer();
    fakeMcpServers.push(fakeMcp);
    const { origin } = await listen();
    const connectorVersionId = await seedConnectorVersion(
      origin,
      fakeMcp.endpointUrl,
    );

    const discovered = await fetchJson(
      `${origin}/v1/connectors/id-1/versions/${connectorVersionId}/discover`,
      { method: "POST" },
    );
    expect(discovered.status).toBe(200);
    expect(discovered.body).toMatchObject({
      connectorVersionId,
    });
    expect(
      (discovered.body as { tools: Array<{ remoteToolName: string }> }).tools
        .map((tool) => tool.remoteToolName)
        .sort(),
    ).toEqual(["echo", "error", "hang", "malformed", "structured"]);
  });

  it("imports MCP tools and reuses ToolVersions when schema is unchanged", async () => {
    const fakeMcp = await startFakeHttpMcpServer();
    fakeMcpServers.push(fakeMcp);
    const { origin } = await listen();
    const connectorVersionId = await seedConnectorVersion(
      origin,
      fakeMcp.endpointUrl,
    );

    const first = await fetchJson(`${origin}/v1/connectors/import-mcp-tools`, {
      method: "POST",
      body: {
        connectorVersionId,
        tools: [
          {
            remoteToolName: "echo",
            toolKey: "echo",
            toolName: "Echo",
          },
        ],
      },
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      imported: [
        {
          remoteToolName: "echo",
          toolKey: "echo",
          createdNewToolVersion: true,
        },
      ],
    });

    const second = await fetchJson(`${origin}/v1/connectors/import-mcp-tools`, {
      method: "POST",
      body: {
        connectorVersionId,
        tools: [
          {
            remoteToolName: "echo",
            toolKey: "echo",
            toolName: "Echo",
          },
        ],
      },
    });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      imported: [
        {
          remoteToolName: "echo",
          toolKey: "echo",
          createdNewToolVersion: false,
          toolVersionId: (
            first.body as { imported: Array<{ toolVersionId: string }> }
          ).imported[0]!.toolVersionId,
        },
      ],
    });
  });

  it("redacts secret-reference keys from public ConnectorVersion responses", async () => {
    const fakeMcp = await startFakeHttpMcpServer({ requireAuth: true });
    fakeMcpServers.push(fakeMcp);
    const { origin } = await listen({
      secrets: { SUPER_SECRET_MCP_KEY_NAME: FAKE_MCP_BEARER_TOKEN },
    });
    await fetchJson(`${origin}/v1/connectors`, {
      method: "POST",
      body: {
        key: "secure-mcp",
        name: "Secure MCP",
      },
    });
    const version = await fetchJson(`${origin}/v1/connectors/id-1/versions`, {
      method: "POST",
      body: {
        kind: "MCP",
        transport: "STREAMABLE_HTTP",
        transportConfig: { endpointUrl: fakeMcp.endpointUrl },
        auth: {
          type: "BEARER",
          tokenSecret: { key: "SUPER_SECRET_MCP_KEY_NAME" },
        },
      },
    });
    expect(version.status).toBe(201);
    const bodyText = JSON.stringify(version.body);
    expect(bodyText).not.toContain("SUPER_SECRET_MCP_KEY_NAME");
    expect(version.body).toMatchObject({
      auth: { type: "BEARER", configured: true },
    });
  });

  it("supports bearer auth on ConnectorVersions during discovery", async () => {
    const fakeMcp = await startFakeHttpMcpServer({ requireAuth: true });
    fakeMcpServers.push(fakeMcp);
    const { origin } = await listen({
      secrets: { MCP_TEST_TOKEN: FAKE_MCP_BEARER_TOKEN },
    });
    await fetchJson(`${origin}/v1/connectors`, {
      method: "POST",
      body: {
        key: "secure-mcp",
        name: "Secure MCP",
      },
    });
    const version = await fetchJson(`${origin}/v1/connectors/id-1/versions`, {
      method: "POST",
      body: {
        kind: "MCP",
        transport: "STREAMABLE_HTTP",
        transportConfig: { endpointUrl: fakeMcp.endpointUrl },
        auth: {
          type: "BEARER",
          tokenSecret: { key: "MCP_TEST_TOKEN" },
        },
      },
    });
    expect(version.status).toBe(201);

    const discovered = await fetchJson(
      `${origin}/v1/connectors/id-1/versions/id-2/discover`,
      { method: "POST" },
    );
    expect(discovered.status).toBe(200);
    expect(
      (discovered.body as { tools: unknown[] }).tools.length,
    ).toBeGreaterThan(0);
  });

  it("returns not_found for unknown Connectors and versions", async () => {
    const { origin } = await listen();
    const connector = await fetchJson(`${origin}/v1/connectors/missing`);
    expect(connector.status).toBe(404);

    await fetchJson(`${origin}/v1/connectors`, {
      method: "POST",
      body: {
        key: "fake-mcp",
        name: "Fake MCP",
      },
    });
    const version = await fetchJson(
      `${origin}/v1/connectors/id-1/versions/missing`,
    );
    expect(version.status).toBe(404);
  });

  async function listen(options?: {
    readonly secrets?: Readonly<Record<string, string>>;
  }) {
    const { server, testApiKey } = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
      secrets: options?.secrets,
    });
    servers.push(server);
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    setTestAuthHeaders(testApiKey);
    return { origin: `http://127.0.0.1:${String(port)}`, testApiKey };
  }
});

async function seedConnectorVersion(
  origin: string,
  endpointUrl: string,
): Promise<string> {
  await fetchJson(`${origin}/v1/connectors`, {
    method: "POST",
    body: {
      key: "fake-mcp",
      name: "Fake MCP",
    },
  });
  const version = await fetchJson(`${origin}/v1/connectors/id-1/versions`, {
    method: "POST",
    body: {
      kind: "MCP",
      transport: "STREAMABLE_HTTP",
      transportConfig: { endpointUrl },
    },
  });
  return (version.body as { id: string }).id;
}
