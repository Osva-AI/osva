import { afterEach, describe, expect, it } from "vitest";

import { authorizationHeader, createTestWebApplication } from "./test-web.js";
import { closeHttpServer, listenHttpServer } from "../src/server.js";

describe("builder-http", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("requires authentication", async () => {
    const ctx = await createTestWebApplication();
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const response = await fetch(`${origin}/v1/builder/proposals/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
  });

  it("POST validate returns structured result for minimal invalid body", async () => {
    const ctx = await createTestWebApplication();
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const response = await fetch(`${origin}/v1/builder/proposals/validate`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ notAProposal: true }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; issues: unknown[] };
    expect(body.ok).toBe(false);
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("POST validate unwraps { proposal } envelope same as raw body", async () => {
    const ctx = await createTestWebApplication();
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const wrapped = await fetch(`${origin}/v1/builder/proposals/validate`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ proposal: { notAProposal: true } }),
    });
    expect(wrapped.status).toBe(200);
    const bodyWrapped = (await wrapped.json()) as {
      ok: boolean;
      issues: unknown[];
    };

    const raw = await fetch(`${origin}/v1/builder/proposals/validate`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ notAProposal: true }),
    });
    expect(raw.status).toBe(200);
    const bodyRaw = (await raw.json()) as { ok: boolean; issues: unknown[] };

    expect(bodyWrapped).toEqual(bodyRaw);
  });
});
