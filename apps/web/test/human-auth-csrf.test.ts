import { describe, expect, it } from "vitest";

import { assertTrustedOrigin } from "../src/human-auth-csrf.js";

function request(
  headers: Record<string, string>,
): import("node:http").IncomingMessage {
  return { headers } as import("node:http").IncomingMessage;
}

describe("assertTrustedOrigin", () => {
  const trusted = ["http://127.0.0.1:4174", "http://127.0.0.1:3000"];

  it("rejects all protected requests when the trusted-origin allowlist is empty", () => {
    expect(
      assertTrustedOrigin(request({ origin: "http://127.0.0.1:4174" }), []),
    ).toBe(false);
    expect(assertTrustedOrigin(request({}), [])).toBe(false);
  });

  it("accepts configured origins and rejects unknown origins", () => {
    expect(
      assertTrustedOrigin(
        request({ origin: "http://127.0.0.1:4174" }),
        trusted,
      ),
    ).toBe(true);
    expect(
      assertTrustedOrigin(request({ origin: "http://evil.example" }), trusted),
    ).toBe(false);
  });

  it("rejects missing Origin and Referer when both are required for validation", () => {
    expect(assertTrustedOrigin(request({}), trusted)).toBe(false);
  });

  it("accepts a trusted Referer when Origin is absent", () => {
    expect(
      assertTrustedOrigin(
        request({ referer: "http://127.0.0.1:3000/v1/auth/login" }),
        trusted,
      ),
    ).toBe(true);
  });

  it("rejects malformed Referer values", () => {
    expect(
      assertTrustedOrigin(request({ referer: "not-a-url" }), trusted),
    ).toBe(false);
    expect(
      assertTrustedOrigin(
        request({ referer: "http://evil.example/path" }),
        trusted,
      ),
    ).toBe(false);
  });

  it("rejects malformed Origin values", () => {
    expect(
      assertTrustedOrigin(request({ origin: "not-an-origin" }), trusted),
    ).toBe(false);
    expect(
      assertTrustedOrigin(request({ origin: "javascript:alert(1)" }), trusted),
    ).toBe(false);
  });

  it("does not treat a present but untrusted Origin as eligible for Referer fallback", () => {
    expect(
      assertTrustedOrigin(
        request({
          origin: "http://evil.example",
          referer: "http://127.0.0.1:3000/v1/auth/login",
        }),
        trusted,
      ),
    ).toBe(false);
  });
});
