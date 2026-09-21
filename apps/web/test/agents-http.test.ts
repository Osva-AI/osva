import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import {
  authHeadersForKey,
  fetchJson,
  setTestAuthHeaders,
} from "./http-test-helpers.js";
import { TEST_NOW, createTestWebApplication } from "./test-web.js";
const WORKSPACE_ID = "ws-1" as WorkspaceId;

const VALID_MANIFEST = {
  schemaVersion: "1",
  key: "example-agent",
  name: "Example Agent",
  runtime: {
    type: "BUILTIN_PACKAGE",
    key: "example-agent",
  },
  input: { schema: {} },
  output: { schema: {} },
  execution: { timeoutMs: 30_000, maxAttempts: 2 },
  capabilities: { model: false, tools: [] },
};

describe("Agent Registry HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("creates, reads, lists, and updates Agents", async () => {
    const { origin } = await listen();

    const created = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: "example-agent",
        name: "Example Agent",
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: "id-1",
      key: "example-agent",
      name: "Example Agent",
      createdAt: TEST_NOW.toISOString(),
    });

    const loaded = await fetchJson(`${origin}/v1/agents/id-1`);
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual(created.body);

    const listed = await fetchJson(`${origin}/v1/agents`);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ agents: [created.body] });

    const updated = await fetchJson(`${origin}/v1/agents/id-1`, {
      method: "PATCH",
      body: { name: "Renamed Agent" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      id: "id-1",
      key: "example-agent",
      name: "Renamed Agent",
    });
  });

  it("returns not_found for an unknown Agent", async () => {
    const { origin } = await listen();
    const response = await fetchJson(`${origin}/v1/agents/missing`);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      status: "error",
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("rejects client-supplied ids, timestamps, and version numbers", async () => {
    const { origin } = await listen();

    const create = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        id: "chosen-id",
        key: "example-agent",
        name: "Example Agent",
        createdAt: TEST_NOW.toISOString(),
      },
    });
    expect(create.status).toBe(400);
    expect(create.body).toEqual({ status: "invalid_request" });

    await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: "example-agent",
        name: "Example Agent",
      },
    });

    const version = await fetchJson(`${origin}/v1/agents/id-1/versions`, {
      method: "POST",
      body: {
        version: 9,
        manifest: VALID_MANIFEST,
      },
    });
    expect(version.status).toBe(400);
    expect(version.body).toEqual({ status: "invalid_request" });
  });

  it("accepts a trusted TypeScript runtime descriptor and rejects traversal", async () => {
    const { origin } = await listen();
    await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: "example-agent",
        name: "Example Agent",
      },
    });

    const trusted = await fetchJson(`${origin}/v1/agents/id-1/versions`, {
      method: "POST",
      body: {
        manifest: {
          ...VALID_MANIFEST,
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "echo-agent.ts",
            integrity: `sha256:${"a".repeat(64)}`,
          },
        },
      },
    });
    expect(trusted.status).toBe(201);
    expect(trusted.body).toMatchObject({
      version: 1,
      manifest: {
        runtime: {
          type: "TRUSTED_TYPESCRIPT",
          entrypoint: "echo-agent.ts",
        },
      },
    });

    const traversal = await fetchJson(`${origin}/v1/agents/id-1/versions`, {
      method: "POST",
      body: {
        manifest: {
          ...VALID_MANIFEST,
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "../echo-agent.ts",
            integrity: `sha256:${"a".repeat(64)}`,
          },
        },
      },
    });
    expect(traversal.status).toBe(400);

    const remote = await fetchJson(`${origin}/v1/agents/id-1/versions`, {
      method: "POST",
      body: {
        manifest: {
          ...VALID_MANIFEST,
          runtime: {
            type: "REMOTE_HTTP",
            protocolVersion: "1",
            endpoint: "https://runtime.example.com/execute",
            authSecretRef: { key: "OSVA_REMOTE_RUNTIME_TOKEN" },
            timeoutMs: 15_000,
          },
        },
      },
    });
    expect(remote.status).toBe(201);
    expect(remote.body).toMatchObject({
      version: 2,
      manifest: {
        runtime: {
          type: "REMOTE_HTTP",
          protocolVersion: "1",
          endpoint: "https://runtime.example.com/execute",
          authSecretRef: { key: "OSVA_REMOTE_RUNTIME_TOKEN" },
          timeoutMs: 15_000,
        },
      },
    });

    const plaintext = await fetchJson(`${origin}/v1/agents/id-1/versions`, {
      method: "POST",
      body: {
        manifest: {
          ...VALID_MANIFEST,
          runtime: {
            type: "REMOTE_HTTP",
            protocolVersion: "1",
            endpoint: "https://runtime.example.com/execute",
            apiKey: "plaintext",
          },
        },
      },
    });
    expect(plaintext.status).toBe(400);

    const privateOptIn = await fetchJson(`${origin}/v1/agents/id-1/versions`, {
      method: "POST",
      body: {
        manifest: {
          ...VALID_MANIFEST,
          runtime: {
            type: "REMOTE_HTTP",
            protocolVersion: "1",
            endpoint: "https://runtime.example.com/execute",
            allowPrivateNetworks: true,
          },
        },
      },
    });
    expect(privateOptIn.status).toBe(400);

    const badEndpoint = await fetchJson(`${origin}/v1/agents/id-1/versions`, {
      method: "POST",
      body: {
        manifest: {
          ...VALID_MANIFEST,
          runtime: {
            type: "REMOTE_HTTP",
            protocolVersion: "1",
            endpoint: "ftp://runtime.example.com/execute",
          },
        },
      },
    });
    expect(badEndpoint.status).toBe(400);
  });

  it("creates, reads, and lists AgentVersions with deterministic numbering", async () => {
    const { origin } = await listen();
    await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: "example-agent",
        name: "Example Agent",
      },
    });
    await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: "other-agent",
        name: "Other Agent",
      },
    });

    const first = await fetchJson(`${origin}/v1/agents/id-1/versions`, {
      method: "POST",
      body: { manifest: VALID_MANIFEST },
    });
    const second = await fetchJson(`${origin}/v1/agents/id-1/versions`, {
      method: "POST",
      body: { manifest: { ...VALID_MANIFEST, name: "Second Snapshot" } },
    });
    const other = await fetchJson(`${origin}/v1/agents/id-2/versions`, {
      method: "POST",
      body: { manifest: { ...VALID_MANIFEST, name: "Other First" } },
    });

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      agentId: "id-1",
      version: 1,
    });
    expect(second.body).toMatchObject({
      agentId: "id-1",
      version: 2,
      manifest: { name: "Second Snapshot" },
    });
    expect(other.body).toMatchObject({
      agentId: "id-2",
      version: 1,
    });

    const listed = await fetchJson(`${origin}/v1/agents/id-1/versions`);
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      versions: [{ version: 1 }, { version: 2 }],
    });

    const loaded = await fetchJson(
      `${origin}/v1/agents/id-1/versions/${String((second.body as { id: string }).id)}`,
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual(second.body);
  });

  it("rejects creating a version for a nonexistent Agent", async () => {
    const { origin } = await listen();
    const response = await fetchJson(`${origin}/v1/agents/missing/versions`, {
      method: "POST",
      body: { manifest: VALID_MANIFEST },
    });
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      status: "error",
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("does not leak an AgentVersion through another Agent nested route", async () => {
    const { origin } = await listen();
    await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: "example-agent",
        name: "Example Agent",
      },
    });
    await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: "other-agent",
        name: "Other Agent",
      },
    });
    const created = await fetchJson(`${origin}/v1/agents/id-1/versions`, {
      method: "POST",
      body: { manifest: VALID_MANIFEST },
    });

    const leaked = await fetchJson(
      `${origin}/v1/agents/id-2/versions/${String((created.body as { id: string }).id)}`,
    );
    expect(leaked.status).toBe(404);
    expect(leaked.body).toMatchObject({
      status: "error",
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("rejects AgentVersion mutation methods", async () => {
    const { origin, authHeaders } = await listen();
    await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: "example-agent",
        name: "Example Agent",
      },
    });
    const created = await fetchJson(`${origin}/v1/agents/id-1/versions`, {
      method: "POST",
      body: { manifest: VALID_MANIFEST },
    });

    const patched = await fetch(
      `${origin}/v1/agents/id-1/versions/${String((created.body as { id: string }).id)}`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({ manifest: VALID_MANIFEST }),
      },
    );
    expect(patched.status).toBe(405);
    expect(patched.headers.get("allow")).toBe("GET");
    expect(await patched.json()).toEqual({ status: "method_not_allowed" });
  });

  async function listen() {
    const { server, testApiKey } = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    servers.push(server);
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    setTestAuthHeaders(testApiKey);
    return {
      origin: `http://127.0.0.1:${String(port)}`,
      authHeaders: authHeadersForKey(testApiKey),
    };
  }
});
