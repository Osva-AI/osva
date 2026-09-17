import { describe, expect, it } from "vitest";

import { isAllowedRemoteRuntimeEndpoint } from "../src/remote-runtime.js";

describe("isAllowedRemoteRuntimeEndpoint", () => {
  it("accepts http and https URLs with a host", () => {
    expect(
      isAllowedRemoteRuntimeEndpoint("https://runtime.example.com/execute"),
    ).toBe(true);
    expect(isAllowedRemoteRuntimeEndpoint("http://127.0.0.1:9/execute")).toBe(
      true,
    );
  });

  it("rejects non-http schemes, userinfo, and missing hosts", () => {
    expect(
      isAllowedRemoteRuntimeEndpoint("ftp://runtime.example.com/execute"),
    ).toBe(false);
    expect(
      isAllowedRemoteRuntimeEndpoint(
        "https://user:secret@runtime.example.com/execute",
      ),
    ).toBe(false);
    expect(isAllowedRemoteRuntimeEndpoint("https://")).toBe(false);
  });
});
