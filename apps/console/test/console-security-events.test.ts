import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetSecurityEventSink,
  SECURITY_EVENT_NAMES,
  setSecurityEventSink,
} from "@osva/observability";

import { OSVA_DEFAULT_JSON_BODY_MAX_BYTES } from "@osva-ai/contracts";

import type { ConsoleConfig } from "../src/server/config.js";
import type { ConsoleOsvaClient } from "../src/server/osva-client.js";
import { createConsoleServer } from "../src/server/server.js";

const testConfig: ConsoleConfig = {
  osvaBaseUrl: "http://127.0.0.1:3000",
  osvaApiKey: "super-secret-console-key",
  legacyApiKeyMode: true,
  host: "127.0.0.1",
  port: 4174,
  clientDistDir: "/tmp/unused",
  allowedOrigins: [],
  browserOrigin: "http://127.0.0.1:4174",
};

function createMockClient(): ConsoleOsvaClient {
  return new Proxy({} as ConsoleOsvaClient, {
    get: (_target, prop) => {
      if (prop === "listRuns") {
        return async () => ({ data: { runs: [] } });
      }
      return async () => {
        throw new Error(`not implemented: ${String(prop)}`);
      };
    },
  });
}

describe("console security events", () => {
  const events: Array<Readonly<Record<string, unknown>>> = [];
  let server: http.Server | undefined;

  afterEach(async () => {
    events.length = 0;
    resetSecurityEventSink();
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
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

  async function listen(): Promise<number> {
    setSecurityEventSink((fields) => {
      events.push(fields);
    });
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient(),
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server address");
    }
    return address.port;
  }

  function request(options: {
    readonly port: number;
    readonly method?: string;
    readonly path?: string;
    readonly headers?: http.OutgoingHttpHeaders;
    readonly body?: string;
  }): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: options.port,
          method: options.method ?? "GET",
          path: options.path ?? "/api/v1/runs",
          headers: options.headers,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => {
            resolve({
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      req.on("error", reject);
      req.end(options.body);
    });
  }

  it("emits one event per rejected Host without echoing the Host value or API key", async () => {
    const port = await listen();
    const response = await request({
      port,
      headers: { host: "evil.example:4174" },
    });
    expect(response.status).toBe(403);
    expect(events).toEqual([
      {
        event: SECURITY_EVENT_NAMES.CONSOLE_INVALID_HOST,
        outcome: "DENIED",
        reasonCode: "invalid_host",
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("evil.example");
    expect(JSON.stringify(events)).not.toContain("super-secret-console-key");
    expect(response.body).not.toContain("super-secret-console-key");
  });

  it("emits a cross-site mutation event without the Origin string", async () => {
    const port = await listen();
    const response = await request({
      port,
      method: "POST",
      headers: {
        host: "127.0.0.1:4174",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect(events).toEqual([
      {
        event: SECURITY_EVENT_NAMES.CONSOLE_CROSS_SITE_MUTATION,
        outcome: "DENIED",
        reasonCode: "cross_site_mutation",
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("evil.example");
  });

  it("emits an invalid origin event once", async () => {
    const port = await listen();
    const response = await request({
      port,
      method: "POST",
      headers: {
        host: "127.0.0.1:4174",
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe(SECURITY_EVENT_NAMES.CONSOLE_INVALID_ORIGIN);
  });

  it("emits one oversized-body event and does not include the API key", async () => {
    const port = await listen();
    const response = await request({
      port,
      method: "POST",
      headers: {
        host: "127.0.0.1:4174",
        origin: "http://127.0.0.1:4174",
        "content-type": "application/json",
      },
      body: "x".repeat(OSVA_DEFAULT_JSON_BODY_MAX_BYTES + 8),
    });
    expect(response.status).toBe(413);
    expect(events).toEqual([
      {
        event: SECURITY_EVENT_NAMES.CONSOLE_REQUEST_TOO_LARGE,
        outcome: "DENIED",
        reasonCode: "request_too_large",
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("super-secret-console-key");
    expect(response.body).not.toContain("super-secret-console-key");
  });

  it("does not emit events for a valid Console GET", async () => {
    const port = await listen();
    const response = await request({
      port,
      headers: { host: "127.0.0.1:4174" },
    });
    expect(response.status).toBe(200);
    expect(events).toEqual([]);
  });
});
