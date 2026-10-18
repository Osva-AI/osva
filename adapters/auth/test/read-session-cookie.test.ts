import { describe, expect, it } from "vitest";

import { readSessionTokenFromCookieHeader } from "../src/better-auth-human-authentication-service.js";

describe("readSessionTokenFromCookieHeader", () => {
  it("extracts osva session tokens from cookie headers", () => {
    expect(
      readSessionTokenFromCookieHeader(
        "osva.session_token=abc123; Path=/; HttpOnly",
      ),
    ).toBe("abc123");
    expect(readSessionTokenFromCookieHeader(undefined)).toBeUndefined();
  });
});
