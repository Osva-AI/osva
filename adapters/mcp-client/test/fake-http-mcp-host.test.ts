import http from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  startFakeHttpMcpServer,
  type FakeHttpMcpServer,
} from "../src/testing/fake-http-mcp-server.js";

function getWithHostHeader(
  port: string,
  hostHeader: string,
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/mcp",
        method: "GET",
        headers: { Host: hostHeader },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("fake HTTP MCP host validation", () => {
  const servers: FakeHttpMcpServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("rejects non-localhost Host headers unless allowAnyHost is enabled", async () => {
    const strict = await startFakeHttpMcpServer({ bindHost: "0.0.0.0" });
    servers.push(strict);
    const strictPort = new URL(strict.endpointUrl).port;

    expect(await getWithHostHeader(strictPort, "host.docker.internal")).toBe(
      403,
    );

    const permissive = await startFakeHttpMcpServer({
      bindHost: "0.0.0.0",
      allowAnyHost: true,
    });
    servers.push(permissive);
    const permissivePort = new URL(permissive.endpointUrl).port;

    expect(
      await getWithHostHeader(permissivePort, "host.docker.internal"),
    ).not.toBe(403);
  });
});
