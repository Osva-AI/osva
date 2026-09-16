import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWithPinnedConnection } from "../src/pinned-fetch.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchWithPinnedConnection", () => {
  it("connects to the pinned IP while preserving the configured hostname for HTTPS TLS", async () => {
    const requestSpy = vi.spyOn(https, "request");
    requestSpy.mockImplementation(((
      _options: https.RequestOptions,
      callback?: (response: http.IncomingMessage) => void,
    ) => {
      const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = 200;
      response.headers = { "content-type": "application/json" };

      queueMicrotask(() => {
        callback?.(response as never);
        response.emit("end");
      });

      return {
        write() {
          return true;
        },
        end() {
          return undefined;
        },
        on() {
          return this;
        },
        destroy() {
          return this;
        },
      } as never;
    }) as unknown as typeof https.request);

    await fetchWithPinnedConnection(
      {
        url: new URL("https://runtime.example.com/execute"),
        hostname: "runtime.example.com",
        address: { address: "93.184.216.34", family: 4 },
      },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );

    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy.mock.calls[0]?.[0]).toMatchObject({
      host: "93.184.216.34",
      servername: "runtime.example.com",
      rejectUnauthorized: true,
      headers: expect.objectContaining({
        host: "runtime.example.com",
      }),
    });
  });

  it("uses the pinned IP for HTTP without a TLS servername", async () => {
    const requestSpy = vi.spyOn(http, "request");
    requestSpy.mockImplementation(((
      _options: http.RequestOptions,
      callback?: (response: http.IncomingMessage) => void,
    ) => {
      const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = 200;
      response.headers = { "content-type": "application/json" };

      queueMicrotask(() => {
        callback?.(response as never);
        response.emit("end");
      });

      return {
        write() {
          return true;
        },
        end() {
          return undefined;
        },
        on() {
          return this;
        },
        destroy() {
          return this;
        },
      } as never;
    }) as unknown as typeof http.request);

    await fetchWithPinnedConnection(
      {
        url: new URL("http://runtime.example.com/execute"),
        hostname: "runtime.example.com",
        address: { address: "93.184.216.34", family: 4 },
      },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );

    expect(requestSpy.mock.calls[0]?.[0]).toMatchObject({
      host: "93.184.216.34",
      headers: expect.objectContaining({
        host: "runtime.example.com",
      }),
    });
    expect(requestSpy.mock.calls[0]?.[0]).not.toHaveProperty("servername");
  });
});
