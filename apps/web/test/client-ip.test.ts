import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";

import {
  parseTrustedProxyCidrs,
  resolveRequestSourceIp,
} from "../src/client-ip.js";

function request(options: {
  readonly remoteAddress?: string;
  readonly headers?: IncomingMessage["headers"];
}): IncomingMessage {
  return {
    socket: { remoteAddress: options.remoteAddress },
    headers: options.headers ?? {},
  } as IncomingMessage;
}

describe("client IP and trusted proxies", () => {
  it("uses the socket address and ignores spoofed forwarding headers by default", () => {
    expect(
      resolveRequestSourceIp(
        request({
          remoteAddress: "203.0.113.10",
          headers: { "x-forwarded-for": "8.8.8.8" },
        }),
        [],
      ),
    ).toBe("203.0.113.10");
  });

  it("uses the rightmost forwarded IP only when the peer is a trusted proxy", () => {
    expect(
      resolveRequestSourceIp(
        request({
          remoteAddress: "10.0.0.2",
          headers: { "x-forwarded-for": "8.8.8.8, 198.51.100.20" },
        }),
        ["10.0.0.0/8"],
      ),
    ).toBe("198.51.100.20");
    expect(
      resolveRequestSourceIp(
        request({
          remoteAddress: "10.0.0.2",
          headers: {
            forwarded: 'for=203.0.113.9;proto=https, for="[2001:db8::1]"',
          },
        }),
        ["10.0.0.0/8"],
      ),
    ).toBe("2001:db8::1");
  });

  it("normalizes IPv4-mapped IPv6 peers", () => {
    expect(
      resolveRequestSourceIp(
        request({ remoteAddress: "::ffff:127.0.0.1" }),
        [],
      ),
    ).toBe("127.0.0.1");
    expect(resolveRequestSourceIp(request({ remoteAddress: "::1" }), [])).toBe(
      "::1",
    );
  });

  it("parses CIDR lists and rejects wildcards", () => {
    expect(parseTrustedProxyCidrs("10.0.0.0/8, 192.168.1.1")).toEqual([
      "10.0.0.0/8",
      "192.168.1.1",
    ]);
    expect(() => parseTrustedProxyCidrs("0.0.0.0/0, *")).toThrow(
      /OSVA_TRUSTED_PROXIES/,
    );
  });
});
