import type { WorkspaceId } from "@osva/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { createTestWebApplication } from "./test-web.js";

const WORKSPACE_ID = "ws-1" as WorkspaceId;

describe("Knowledge HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("lists knowledge sources for a workspace", async () => {
    const { server } = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    servers.push(server);
    const origin = `http://127.0.0.1:${port}`;

    const response = await fetch(
      `${origin}/v1/knowledge-sources?workspaceId=${WORKSPACE_ID}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it("rejects invalid retrieve payloads", async () => {
    const { server } = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    servers.push(server);
    const origin = `http://127.0.0.1:${port}`;

    const response = await fetch(`${origin}/v1/knowledge/retrieve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        knowledgeIndexIds: [],
        query: "",
      }),
    });
    expect(response.status).toBe(400);
  });
});
