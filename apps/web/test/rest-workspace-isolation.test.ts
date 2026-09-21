import type { WorkspaceId } from "@osva/contracts";
import { COMMUNITY_EDITION_ROLES } from "@osva/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import {
  authorizationHeader,
  createTestWebApplication,
  seedTestApiKey,
} from "./test-web.js";

const WS_A = "ws-iso-a" as WorkspaceId;
const WS_B = "ws-iso-b" as WorkspaceId;

describe("REST workspace isolation (Pass 2)", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("lists agents only in the authenticated workspace", async () => {
    const { origin, authA, authB, agentIdInA } = await listenTwoWorkspaces();

    const listA = await fetchJson(`${origin}/v1/agents`, { headers: authA });
    expect(listA.status).toBe(200);
    expect((listA.body as { agents: unknown[] }).agents).toHaveLength(1);

    const listB = await fetchJson(`${origin}/v1/agents`, { headers: authB });
    expect(listB.status).toBe(200);
    expect((listB.body as { agents: unknown[] }).agents).toHaveLength(0);

    const cross = await fetchJson(`${origin}/v1/agents/${agentIdInA}`, {
      headers: authB,
    });
    expect(cross.status).toBe(404);
  });

  it("ignores legacy workspaceId in create body", async () => {
    const { origin, authA } = await listenTwoWorkspaces();
    const created = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      headers: authA,
      body: {
        key: "wrong-ws",
        name: "Wrong WS",
      },
    });
    expect(created.status).toBe(201);
    expect((created.body as { workspaceId: string }).workspaceId).toBe(WS_A);
  });

  it("returns 403 when role cannot write", async () => {
    const { origin, viewerAuth } = await listenViewer();
    const denied = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      headers: viewerAuth,
      body: { key: "x", name: "X" },
    });
    expect(denied.status).toBe(403);
  });

  async function listenTwoWorkspaces() {
    const { server, agents, workspaces, apiKeys, testApiKey } =
      await createTestWebApplication({ workspaceId: WS_A });
    await workspaces.save(
      (await import("@osva/domain")).Workspace.create({
        id: WS_B,
        name: "B",
        createdAt: new Date("2026-01-15T12:00:00.000Z"),
      }),
    );
    await seedTestApiKey({
      apiKeys,
      workspaceId: WS_B,
      apiKeyId: "ak-b" as import("@osva/contracts").ApiKeyId,
    });
    const authB = authorizationHeader(
      (
        await seedTestApiKey({
          apiKeys,
          workspaceId: WS_B,
          apiKeyId: "ak-b2" as import("@osva/contracts").ApiKeyId,
        })
      ).plaintextToken,
    );
    servers.push(server);
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const authA = authorizationHeader(testApiKey.plaintextToken);

    const created = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      headers: authA,
      body: { key: "a1", name: "A1" },
    });
    const agentIdInA = (created.body as { id: string }).id;
    void agents;

    return { origin, authA, authB, agentIdInA };
  }

  async function listenViewer() {
    const { server, apiKeys } = await createTestWebApplication({
      workspaceId: WS_A,
    });
    const viewer = await seedTestApiKey({
      apiKeys,
      workspaceId: WS_A,
      role: COMMUNITY_EDITION_ROLES.VIEWER,
      apiKeyId: "ak-viewer" as import("@osva/contracts").ApiKeyId,
    });
    servers.push(server);
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    return {
      origin: `http://127.0.0.1:${String(port)}`,
      viewerAuth: authorizationHeader(viewer.plaintextToken),
    };
  }
});

async function fetchJson(
  url: string,
  options?: {
    readonly method?: string;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: options?.method ?? "GET",
    headers: {
      ...options?.headers,
      ...(options?.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    body:
      options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: await response.json() };
}
