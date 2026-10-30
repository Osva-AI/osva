import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createConsoleServer } from "../src/server/server.js";

describe("human session BFF", () => {
  let upstream: http.Server | undefined;
  let consoleServer: http.Server | undefined;

  afterEach(async () => {
    for (const server of [consoleServer, upstream]) {
      if (server !== undefined) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    }
    upstream = undefined;
    consoleServer = undefined;
  });

  it("forwards session cookie without Authorization and returns sanitized Set-Cookie", async () => {
    let capturedCookie: string | undefined;
    let capturedAuthorization: string | undefined;

    upstream = http.createServer((request, response) => {
      capturedCookie = request.headers.cookie;
      capturedAuthorization = request.headers.authorization;
      if (request.url === "/v1/auth/login" && request.method === "POST") {
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie":
            "osva.session_token=secret-token; Domain=api.internal; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600",
          "x-osva-request-id": "req-login",
        });
        response.end(
          JSON.stringify({
            userId: "user-1",
            expiresAt: "2099-01-01T00:00:00.000Z",
          }),
        );
        return;
      }
      response.writeHead(404);
      response.end();
    });

    await new Promise<void>((resolve) => upstream!.listen(0, resolve));
    const upstreamAddress = upstream!.address();
    if (upstreamAddress === null || typeof upstreamAddress === "string") {
      throw new Error("expected upstream address");
    }

    consoleServer = createConsoleServer({
      config: {
        osvaBaseUrl: `http://127.0.0.1:${upstreamAddress.port}`,
        legacyApiKeyMode: false,
        host: "127.0.0.1",
        port: 0,
        clientDistDir: "/tmp/unused",
        allowedOrigins: [],
        browserOrigin: "http://127.0.0.1:4174",
      },
    });
    await new Promise<void>((resolve) => consoleServer!.listen(0, resolve));
    const consoleAddress = consoleServer!.address();
    if (consoleAddress === null || typeof consoleAddress === "string") {
      throw new Error("expected console address");
    }

    const login = await fetch(
      `http://127.0.0.1:${consoleAddress.port}/api/v1/auth/login`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: `http://127.0.0.1:${consoleAddress.port}`,
        },
        body: JSON.stringify({ email: "a@b.c", password: "x" }),
      },
    );
    const body = await login.json();
    expect(login.status).toBe(200);
    expect(body).toMatchObject({ userId: "user-1" });
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(capturedAuthorization).toBeUndefined();
    expect(capturedCookie).toBeUndefined();
    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("osva.session_token=");
    expect(setCookie.toLowerCase()).not.toContain("domain=");
  });

  it("rejects browser Authorization headers", async () => {
    consoleServer = createConsoleServer({
      config: {
        osvaBaseUrl: "http://127.0.0.1:9",
        legacyApiKeyMode: false,
        host: "127.0.0.1",
        port: 0,
        clientDistDir: "/tmp/unused",
        allowedOrigins: [],
        browserOrigin: "http://127.0.0.1:4174",
      },
    });
    await new Promise<void>((resolve) => consoleServer!.listen(0, resolve));
    const consoleAddress = consoleServer!.address();
    if (consoleAddress === null || typeof consoleAddress === "string") {
      throw new Error("expected console address");
    }

    const response = await fetch(
      `http://127.0.0.1:${consoleAddress.port}/api/v1/agents`,
      { headers: { authorization: "Bearer osva_ak_test" } },
    );
    expect(response.status).toBe(403);
  });
});
