import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPinnedOutboundFetch,
  OutboundNetworkPolicyError,
} from "../src/pinned-outbound-fetch.js";
import * as pinnedFetchModule from "../src/pinned-fetch.js";

describe("createPinnedOutboundFetch request headers", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          }),
      ),
    );
    servers.length = 0;
    vi.restoreAllMocks();
  });

  it("drops forbidden headers case-insensitively and keeps safe custom headers", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("server failed to bind");
    }

    const spy = vi.spyOn(pinnedFetchModule, "fetchWithPinnedConnection");
    spy.mockResolvedValue(new Response("ok", { status: 200 }));

    const fetchImpl = createPinnedOutboundFetch({
      allowPrivateNetworks: true,
    });
    await fetchImpl(
      new Request(`http://127.0.0.1:${String(address.port)}/mcp`, {
        method: "POST",
        headers: {
          Host: "evil.example",
          "content-length": "999",
          Connection: "close",
          "X-Osva-Safe": "allowed",
          "proxy-authorization": "secret",
        },
        body: "{}",
      }),
    );

    const init = spy.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["x-osva-safe"]).toBe("allowed");
    expect(headers).not.toHaveProperty("Host");
    expect(headers).not.toHaveProperty("host");
    expect(headers).not.toHaveProperty("content-length");
    expect(headers).not.toHaveProperty("Connection");
    expect(headers).not.toHaveProperty("connection");
    expect(headers).not.toHaveProperty("proxy-authorization");
  });

  it("rejects redirect responses without following them", async () => {
    const spy = vi.spyOn(pinnedFetchModule, "fetchWithPinnedConnection");
    spy.mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { Location: "http://127.0.0.1:9/steal" },
      }),
    );

    const fetchImpl = createPinnedOutboundFetch({
      allowPrivateNetworks: false,
    });

    await expect(
      fetchImpl("https://example.com/mcp", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toBeInstanceOf(OutboundNetworkPolicyError);
  });
});
