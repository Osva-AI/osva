import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { fetchJson, setTestAuthHeaders } from "./http-test-helpers.js";
import { TEST_NOW, createTestWebApplication } from "./test-web.js";

const WORKSPACE_ID = "ws-1" as WorkspaceId;

describe("Tool Registry HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("creates, reads, lists, and renames Tools", async () => {
    const { origin } = await listen();
    const created = await fetchJson(`${origin}/v1/tools`, {
      method: "POST",
      body: {
        key: "echo",
        name: "Echo",
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: "id-1",
      key: "echo",
      name: "Echo",
      createdAt: TEST_NOW.toISOString(),
    });

    const loaded = await fetchJson(`${origin}/v1/tools/id-1`);
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual(created.body);

    const listed = await fetchJson(`${origin}/v1/tools`);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ tools: [created.body] });

    const updated = await fetchJson(`${origin}/v1/tools/id-1`, {
      method: "PATCH",
      body: { name: "Renamed Echo" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ key: "echo", name: "Renamed Echo" });
  });

  it("appends immutable ToolVersions and rejects unknown implementations", async () => {
    const { origin } = await listen();
    await fetchJson(`${origin}/v1/tools`, {
      method: "POST",
      body: {
        key: "echo",
        name: "Echo",
      },
    });
    const v1 = await fetchJson(`${origin}/v1/tools/id-1/versions`, {
      method: "POST",
      body: { type: "INTERNAL", implementation: "OSVA_ECHO_V1" },
    });
    expect(v1.status).toBe(201);
    expect(v1.body).toMatchObject({
      toolId: "id-1",
      version: 1,
      type: "INTERNAL",
      implementation: "OSVA_ECHO_V1",
    });

    const invalid = await fetchJson(`${origin}/v1/tools/id-1/versions`, {
      method: "POST",
      body: { type: "INTERNAL", implementation: "UNKNOWN_TOOL" },
    });
    expect(invalid.status).toBe(400);
  });

  async function listen() {
    const { server, testApiKey } = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    servers.push(server);
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    setTestAuthHeaders(testApiKey);
    return { origin: `http://127.0.0.1:${String(port)}` };
  }
});
