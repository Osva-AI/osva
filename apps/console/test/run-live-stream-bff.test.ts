import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import type { RunId } from "@osva-ai/contracts";

import type { ConsoleOsvaClient } from "../src/server/osva-client.js";
import { createConsoleServer } from "../src/server/server.js";

describe("run live stream BFF", () => {
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

  it("proxies authenticated SSE incrementally", async () => {
    upstream = http.createServer((request, response) => {
      const path = request.url?.split("?")[0] ?? "";
      if (path === "/v1/runs/run-1/stream") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        response.write('event: ready\ndata: {"replay":false}\n\n');
        response.write(
          'event: run-live\ndata: {"formatVersion":"1","viewerEvent":{"kind":"STREAM_STATUS","status":"ended"}}\n\n',
        );
        response.end();
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

    const testClient: ConsoleOsvaClient = {
      streamRunLive: async (runId: RunId, clientAbort: AbortSignal) => {
        void runId;
        void clientAbort;
        const response = await fetch(
          `http://127.0.0.1:${String(upstreamAddress.port)}/v1/runs/run-1/stream`,
        );
        return {
          status: response.status,
          headers: response.headers,
          body: response.body,
        };
      },
    } as unknown as ConsoleOsvaClient;

    consoleServer = createConsoleServer({
      config: {
        osvaBaseUrl: `http://127.0.0.1:${String(upstreamAddress.port)}`,
        legacyApiKeyMode: false,
        host: "127.0.0.1",
        port: 0,
        clientDistDir: "/tmp/unused",
        allowedOrigins: [],
        browserOrigin: "http://127.0.0.1:4174",
      },
      client: testClient,
    });
    await new Promise<void>((resolve) => consoleServer!.listen(0, resolve));
    const consoleAddress = consoleServer!.address();
    if (consoleAddress === null || typeof consoleAddress === "string") {
      throw new Error("expected console address");
    }

    const response = await fetch(
      `http://127.0.0.1:${String(consoleAddress.port)}/api/v1/runs/run-1/stream`,
      {
        headers: {
          "x-osva-workspace-id": "ws-test",
          cookie: "osva.session_token=test",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    if (reader !== undefined) {
      const { value } = await reader.read();
      buffer += decoder.decode(value);
    }

    expect(buffer).toContain("event: ready");
    expect(buffer).toContain("run-live");
  });

  it("returns 404 from upstream without leaking other workspace payloads", async () => {
    upstream = http.createServer((_request, response) => {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "not_found" }));
    });
    await new Promise<void>((resolve) => upstream!.listen(0, resolve));
    const upstreamAddress = upstream!.address();
    if (upstreamAddress === null || typeof upstreamAddress === "string") {
      throw new Error("expected upstream address");
    }

    const testClient = {
      streamRunLive: async () => {
        const response = await fetch(
          `http://127.0.0.1:${String(upstreamAddress.port)}/v1/runs/foreign/stream`,
        );
        const text = await response.text();
        return {
          status: response.status,
          headers: response.headers,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(text));
              controller.close();
            },
          }),
        };
      },
    } as unknown as ConsoleOsvaClient;

    consoleServer = createConsoleServer({
      config: {
        osvaBaseUrl: `http://127.0.0.1:${String(upstreamAddress.port)}`,
        legacyApiKeyMode: false,
        host: "127.0.0.1",
        port: 0,
        clientDistDir: "/tmp/unused",
        allowedOrigins: [],
        browserOrigin: "http://127.0.0.1:4174",
      },
      client: testClient,
    });
    await new Promise<void>((resolve) => consoleServer!.listen(0, resolve));
    const consoleAddress = consoleServer!.address();
    if (consoleAddress === null || typeof consoleAddress === "string") {
      throw new Error("expected console address");
    }

    const response = await fetch(
      `http://127.0.0.1:${String(consoleAddress.port)}/api/v1/runs/foreign/stream`,
      {
        headers: { "x-osva-workspace-id": "ws-b" },
      },
    );
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain("TEXT_DELTA");
  });
});
