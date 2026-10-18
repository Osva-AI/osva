import { afterEach, describe, expect, it } from "vitest";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import type { WorkspaceId } from "@osva-ai/contracts";

import {
  authHeadersForKey,
  fetchJson,
  setTestAuthHeaders,
} from "./http-test-helpers.js";
import { createTestWebApplication } from "./test-web.js";

const WORKSPACE_ID = "ws-1" as WorkspaceId;

describe("ModelProviderConnection Registry HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("creates connections, appends redacted versions, and tests connectivity", async () => {
    const { origin } = await listen();
    const created = await fetchJson(`${origin}/v1/model-provider-connections`, {
      method: "POST",
      body: {
        key: "openai-prod",
        name: "OpenAI production",
        provider: "OPENAI",
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: "id-1",
      key: "openai-prod",
      provider: "OPENAI",
    });
    expect(JSON.stringify(created.body)).not.toContain("sk-");

    const version = await fetchJson(
      `${origin}/v1/model-provider-connections/id-1/versions`,
      {
        method: "POST",
        body: {
          credentialRef: { key: "OPENAI_API_KEY" },
          endpoint: { baseUrl: "https://api.openai.com/v1" },
        },
      },
    );
    expect(version.status).toBe(201);
    expect(version.body).toMatchObject({
      version: 1,
      credential: { configured: true },
    });
    expect(JSON.stringify(version.body)).not.toContain("OPENAI_API_KEY");

    const testMissingModel = await fetchJson(
      `${origin}/v1/model-provider-connections/id-1/versions/id-2/test`,
      { method: "POST", body: {} },
    );
    expect(testMissingModel.status).toBe(400);

    const test = await fetchJson(
      `${origin}/v1/model-provider-connections/id-1/versions/id-2/test`,
      {
        method: "POST",
        body: { model: "gpt-test-snapshot" },
      },
    );
    expect(test.status).toBe(200);
    expect(test.body).toMatchObject({ status: "READY" });
    expect(JSON.stringify(test.body)).not.toContain("OPENAI_API_KEY");
    expect(JSON.stringify(test.body)).not.toContain("sk-");
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
