import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { TEST_NOW, createTestWebApplication } from "./test-web.js";

const WORKSPACE_ID = "ws-1" as WorkspaceId;

describe("ModelProfile Registry HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("creates, reads, lists, and renames ModelProfiles", async () => {
    const { origin } = await listen();
    const created = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "primary",
        name: "Primary",
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: "id-1",
      workspaceId: WORKSPACE_ID,
      key: "primary",
      name: "Primary",
      createdAt: TEST_NOW.toISOString(),
    });
    expect(JSON.stringify(created.body)).not.toContain("sk-");
    expect(created.body).not.toHaveProperty("apiKey");

    const loaded = await fetchJson(`${origin}/v1/model-profiles/id-1`);
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual(created.body);

    const listed = await fetchJson(`${origin}/v1/model-profiles`);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ modelProfiles: [created.body] });

    const updated = await fetchJson(`${origin}/v1/model-profiles/id-1`, {
      method: "PATCH",
      body: { name: "Renamed" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ key: "primary", name: "Renamed" });
  });

  it("returns not_found for an unknown ModelProfile", async () => {
    const { origin } = await listen();
    const response = await fetchJson(`${origin}/v1/model-profiles/missing`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ status: "not_found" });
  });

  it("appends immutable ModelProfileVersions and rejects version mutation", async () => {
    const { origin } = await listen();
    await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "primary",
        name: "Primary",
      },
    });
    const v1 = await fetchJson(`${origin}/v1/model-profiles/id-1/versions`, {
      method: "POST",
      body: { provider: "OPENAI", model: "gpt-one" },
    });
    const v2 = await fetchJson(`${origin}/v1/model-profiles/id-1/versions`, {
      method: "POST",
      body: { provider: "OPENAI", model: "gpt-two" },
    });
    expect(v1.status).toBe(201);
    expect(v2.status).toBe(201);
    expect(v1.body).toMatchObject({
      version: 1,
      provider: "OPENAI",
      model: "gpt-one",
    });
    expect(v2.body).toMatchObject({ version: 2, model: "gpt-two" });
    expect(v1.body).not.toHaveProperty("apiKey");

    const listed = await fetchJson(`${origin}/v1/model-profiles/id-1/versions`);
    expect(listed.status).toBe(200);
    expect((listed.body as { versions: unknown[] }).versions).toHaveLength(2);

    const patched = await fetch(
      `${origin}/v1/model-profiles/id-1/versions/${String((v1.body as { id: string }).id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "mutated" }),
      },
    );
    expect(patched.status).toBe(405);
    expect(patched.headers.get("allow")).toBe("GET");
  });

  it("enforces nested ModelProfileVersion ownership", async () => {
    const { origin } = await listen();
    await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "primary",
        name: "Primary",
      },
    });
    await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "secondary",
        name: "Secondary",
      },
    });
    const created = await fetchJson(
      `${origin}/v1/model-profiles/id-1/versions`,
      {
        method: "POST",
        body: { provider: "OPENAI", model: "gpt-one" },
      },
    );
    const leaked = await fetchJson(
      `${origin}/v1/model-profiles/id-2/versions/${String((created.body as { id: string }).id)}`,
    );
    expect(leaked.status).toBe(404);
  });

  it("rejects client-supplied version numbers and credentials", async () => {
    const { origin } = await listen();
    await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "primary",
        name: "Primary",
      },
    });
    const created = await fetchJson(
      `${origin}/v1/model-profiles/id-1/versions`,
      {
        method: "POST",
        body: {
          version: 9,
          provider: "OPENAI",
          model: "gpt-one",
          apiKey: "sk-secret",
        },
      },
    );
    expect(created.status).toBe(400);
    expect(created.body).toEqual({ status: "invalid_request" });
  });

  async function listen() {
    const { server } = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    servers.push(server);
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    return { origin: `http://127.0.0.1:${String(port)}` };
  }
});

async function fetchJson(
  url: string,
  options?: { readonly method?: string; readonly body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: options?.method ?? "GET",
    headers:
      options?.body === undefined
        ? undefined
        : { "content-type": "application/json" },
    body:
      options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: await response.json() };
}
