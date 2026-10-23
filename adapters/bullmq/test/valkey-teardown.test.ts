import { describe, expect, it } from "vitest";

import { isIgnorableValkeyTeardownError } from "../src/connection.js";

describe("isIgnorableValkeyTeardownError", () => {
  it("matches common client-close errors only", () => {
    expect(
      isIgnorableValkeyTeardownError(new Error("Connection is closed.")),
    ).toBe(true);
    expect(isIgnorableValkeyTeardownError(new Error("Socket closed"))).toBe(
      true,
    );
  });

  it("does not treat live connectivity failures as teardown noise", () => {
    expect(
      isIgnorableValkeyTeardownError(new Error("connect ECONNREFUSED")),
    ).toBe(false);
    expect(isIgnorableValkeyTeardownError(new Error("READONLY"))).toBe(false);
  });
});
