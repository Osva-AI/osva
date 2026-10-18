import { describe, expect, it } from "vitest";

import {
  buildForwardSessionCookieHeader,
  readOsvaSessionCookieValue,
  sanitizeSessionSetCookieHeaders,
} from "../src/server/session-cookie.js";

describe("session cookie transport", () => {
  it("forwards only osva.session_token from browser cookies", () => {
    expect(
      buildForwardSessionCookieHeader(
        "other=1; osva.session_token=abc%2F123; another=two",
      ),
    ).toBe("osva.session_token=abc%2F123");
  });

  it("strips Domain from upstream Set-Cookie", () => {
    expect(
      sanitizeSessionSetCookieHeaders(
        "osva.session_token=abc; Domain=api.example.com; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600",
      ),
    ).toEqual([
      "osva.session_token=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600",
    ]);
  });

  it("ignores unrelated Set-Cookie names", () => {
    expect(sanitizeSessionSetCookieHeaders("session=1; Path=/")).toEqual([]);
    expect(readOsvaSessionCookieValue("session=1")).toBeUndefined();
  });
});
