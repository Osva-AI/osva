import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";

import { isLoopbackBindHost } from "../src/server/loopback.js";
import {
  evaluateConsoleApiRequestGuard,
  isAllowedConsoleOrigin,
  parseAllowedConsoleOrigins,
  parseHostHeader,
} from "../src/server/request-guard.js";

function request(
  headers: Readonly<Record<string, string | undefined>>,
  method = "POST",
): IncomingMessage {
  return { method, headers } as IncomingMessage;
}

describe("console loopback and request guard", () => {
  it("recognizes IPv4, IPv6, mapped, and localhost loopback binds", () => {
    expect(isLoopbackBindHost("127.0.0.1")).toBe(true);
    expect(isLoopbackBindHost("127.0.0.2")).toBe(true);
    expect(isLoopbackBindHost("::1")).toBe(true);
    expect(isLoopbackBindHost("[::1]")).toBe(true);
    expect(isLoopbackBindHost("localhost")).toBe(true);
    expect(isLoopbackBindHost("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackBindHost("0.0.0.0")).toBe(false);
    expect(isLoopbackBindHost("192.168.1.10")).toBe(false);
    expect(isLoopbackBindHost("localhost.evil")).toBe(false);
    expect(isLoopbackBindHost("::ffff:10.0.0.1")).toBe(false);
  });

  it("parses IPv4 and bracketed IPv6 Host headers", () => {
    expect(parseHostHeader("127.0.0.1:4174")?.hostname).toBe("127.0.0.1");
    expect(parseHostHeader("[::1]:4174")?.hostname).toBe("::1");
    expect(parseHostHeader("localhost")?.hostname).toBe("localhost");
  });

  it("allows same-origin and loopback Origin mutations and rejects foreign origins", () => {
    expect(
      evaluateConsoleApiRequestGuard(
        request({
          host: "127.0.0.1:4174",
          origin: "http://127.0.0.1:4174",
          "sec-fetch-site": "same-origin",
        }),
        { allowedOrigins: [] },
      ),
    ).toEqual({ allowed: true });

    expect(
      evaluateConsoleApiRequestGuard(
        request({
          host: "127.0.0.1:4174",
          origin: "http://127.0.0.1:5173",
        }),
        { allowedOrigins: [] },
      ),
    ).toEqual({ allowed: true });

    const foreign = evaluateConsoleApiRequestGuard(
      request({
        host: "127.0.0.1:4174",
        origin: "https://evil.example",
      }),
      { allowedOrigins: [] },
    );
    expect(foreign.allowed).toBe(false);
    if (!foreign.allowed) {
      expect(foreign.code).toBe("invalid_origin");
    }
  });

  it("rejects cross-site Sec-Fetch-Site and malicious Host", () => {
    const crossSite = evaluateConsoleApiRequestGuard(
      request({
        host: "127.0.0.1:4174",
        "sec-fetch-site": "cross-site",
      }),
      { allowedOrigins: [] },
    );
    expect(crossSite.allowed).toBe(false);

    const host = evaluateConsoleApiRequestGuard(
      request({ host: "evil.example" }, "GET"),
      { allowedOrigins: [] },
    );
    expect(host.allowed).toBe(false);
    if (!host.allowed) {
      expect(host.code).toBe("invalid_host");
    }
  });

  it("allows missing Origin for non-browser clients and rejects forwarded host headers", () => {
    expect(
      evaluateConsoleApiRequestGuard(request({ host: "127.0.0.1:4174" }), {
        allowedOrigins: [],
      }),
    ).toEqual({ allowed: true });

    const forwarded = evaluateConsoleApiRequestGuard(
      request({
        host: "127.0.0.1:4174",
        "x-forwarded-host": "evil.example",
      }),
      { allowedOrigins: [] },
    );
    expect(forwarded.allowed).toBe(false);
  });

  it("allows an explicit operator origin without treating it as CORS", () => {
    expect(
      isAllowedConsoleOrigin("https://console.example.com", [
        "https://console.example.com",
      ]),
    ).toBe(true);
    expect(parseAllowedConsoleOrigins("https://console.example.com")).toEqual([
      "https://console.example.com",
    ]);
  });
});
