import { afterEach, describe, expect, it } from "vitest";

import { createWebApplication } from "../src/http.js";
import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { createTestWebApplication } from "./test-web.js";

describe("web HTTP shell", () => {
  const servers: ReturnType<typeof createWebApplication>[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  async function listen(
    readinessCheck: () => Promise<boolean> = async () => true,
  ) {
    const { server } = await createTestWebApplication({ readinessCheck });
    servers.push(server);
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    return { server, origin: `http://127.0.0.1:${String(port)}` };
  }

  it("returns 200 for GET /health", async () => {
    const { origin } = await listen();
    const response = await fetch(`${origin}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns 200 for GET /ready when readiness succeeds", async () => {
    const { origin } = await listen(async () => true);
    const response = await fetch(`${origin}/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("returns 503 for GET /ready when readiness fails", async () => {
    const { origin } = await listen(async () => false);
    const response = await fetch(`${origin}/ready`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });

  it("does not leak raw Error messages when readiness throws", async () => {
    const { origin } = await listen(async () => {
      throw new Error("ECONNREFUSED postgres://secret@127.0.0.1/osva");
    });
    const response = await fetch(`${origin}/ready`);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe(JSON.stringify({ status: "unavailable" }));
    expect(body).not.toContain("postgres://");
    expect(body).not.toContain("secret");
    expect(body).not.toContain("ECONNREFUSED");
  });

  it("does not invoke readiness for GET /health", async () => {
    let readinessCalls = 0;
    const { origin } = await listen(async () => {
      readinessCalls += 1;
      return true;
    });

    const response = await fetch(`${origin}/health`);

    expect(response.status).toBe(200);
    expect(readinessCalls).toBe(0);
  });

  it("returns 404 for an unknown route", async () => {
    const { origin } = await listen();
    const response = await fetch(`${origin}/runs`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: "not_found" });
  });

  it("returns 405 for unsupported methods on known routes", async () => {
    const { origin } = await listen();
    const health = await fetch(`${origin}/health`, { method: "POST" });
    const ready = await fetch(`${origin}/ready`, { method: "PUT" });

    expect(health.status).toBe(405);
    expect(health.headers.get("allow")).toBe("GET");
    expect(await health.json()).toEqual({ status: "method_not_allowed" });
    expect(ready.status).toBe(405);
    expect(await ready.json()).toEqual({ status: "method_not_allowed" });
  });

  it("returns 404 for unsupported methods on unknown routes", async () => {
    const { origin } = await listen();
    const response = await fetch(`${origin}/agents`, { method: "POST" });
    expect(response.status).toBe(404);
  });
});
