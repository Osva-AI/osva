import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { OSVA_REQUEST_ID_HEADER } from "@osva-ai/contracts";

import { OsvaHttpClient } from "../src/http-client.js";
import { OsvaApiError } from "../src/errors.js";

describe("OsvaHttpClient request IDs", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      server = undefined;
    }
  });

  it("returns request ID from successful upstream responses", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/json",
        [OSVA_REQUEST_ID_HEADER]: "req-success-1",
      });
      res.end(JSON.stringify({ runs: [] }));
    });
    await listen(server);
    const client = createClient(server);

    const result = await client.requestWithMeta({
      method: "GET",
      path: "/v1/runs",
    });
    expect(result.requestId).toBe("req-success-1");
    expect(result.data).toEqual({ runs: [] });
  });

  it("preserves request ID on 401 responses", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(401, {
        "Content-Type": "application/json",
        [OSVA_REQUEST_ID_HEADER]: "req-auth-401",
      });
      res.end(
        JSON.stringify({
          status: "error",
          code: "authentication_required",
          requestId: "req-auth-401",
        }),
      );
    });
    await listen(server);
    const client = createClient(server);

    await expect(
      client.request({ method: "GET", path: "/v1/auth/context" }),
    ).rejects.toMatchObject({
      requestId: "req-auth-401",
    } satisfies Partial<OsvaApiError>);
  });

  it("preserves request ID on 403 responses", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(403, {
        "Content-Type": "application/json",
        [OSVA_REQUEST_ID_HEADER]: "req-forbidden",
      });
      res.end(JSON.stringify({ status: "error", code: "permission_denied" }));
    });
    await listen(server);
    const client = createClient(server);

    await expect(
      client.request({ method: "GET", path: "/v1/runs" }),
    ).rejects.toMatchObject({ requestId: "req-forbidden" });
  });

  it("preserves request ID on 404 responses", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(404, {
        "Content-Type": "application/json",
        [OSVA_REQUEST_ID_HEADER]: "req-not-found",
      });
      res.end(JSON.stringify({ status: "not_found" }));
    });
    await listen(server);
    const client = createClient(server);

    await expect(
      client.request({ method: "GET", path: "/v1/runs/missing" }),
    ).rejects.toMatchObject({ requestId: "req-not-found" });
  });

  it("preserves request ID on 5xx responses", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(500, {
        "Content-Type": "application/json",
        [OSVA_REQUEST_ID_HEADER]: "req-server-error",
      });
      res.end(JSON.stringify({ status: "error" }));
    });
    await listen(server);
    const client = createClient(server);

    await expect(
      client.request({ method: "GET", path: "/v1/runs" }),
    ).rejects.toMatchObject({ requestId: "req-server-error" });
  });

  it("allows missing request IDs", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ runs: [] }));
    });
    await listen(server);
    const client = createClient(server);

    const result = await client.requestWithMeta({
      method: "GET",
      path: "/v1/runs",
    });
    expect(result.requestId).toBeUndefined();
  });
});

async function listen(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, resolve));
}

function createClient(server: http.Server): OsvaHttpClient {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected server address");
  }
  return new OsvaHttpClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiKey: "test-key",
  });
}
