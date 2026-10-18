import { describe, expect, it } from "vitest";

import { assertTrustedOrigin } from "../src/human-auth-csrf.js";

describe("assertTrustedOrigin", () => {
  it("accepts configured origins and rejects unknown origins", () => {
    const trusted = ["http://127.0.0.1:4174"];
    expect(
      assertTrustedOrigin(
        {
          headers: { origin: "http://127.0.0.1:4174" },
        } as import("node:http").IncomingMessage,
        trusted,
      ),
    ).toBe(true);
    expect(
      assertTrustedOrigin(
        {
          headers: { origin: "http://evil.example" },
        } as import("node:http").IncomingMessage,
        trusted,
      ),
    ).toBe(false);
  });
});
