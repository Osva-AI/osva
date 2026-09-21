import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import {
  OSVA_DEFAULT_JSON_BODY_MAX_BYTES,
  PUBLIC_API_ERROR_CODES,
} from "@osva/contracts";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { authorizationHeader, createTestWebApplication } from "./test-web.js";

describe("JSON body size limits", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("accepts bodies under the default JSON limit", async () => {
    const ctx = await createTestWebApplication();
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/agents`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ key: "small", name: "Small" }),
    });
    expect(response.status).toBe(201);
  });

  it("returns REQUEST_TOO_LARGE for oversized JSON control-plane requests", async () => {
    const ctx = await createTestWebApplication();
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const oversized = "x".repeat(OSVA_DEFAULT_JSON_BODY_MAX_BYTES + 32);
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/agents`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ key: oversized, name: "Too Large" }),
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as {
      code?: string;
      requestId?: string;
    };
    expect(body.code).toBe(PUBLIC_API_ERROR_CODES.REQUEST_TOO_LARGE);
    expect(body.requestId).toEqual(expect.any(String));
  });
});
