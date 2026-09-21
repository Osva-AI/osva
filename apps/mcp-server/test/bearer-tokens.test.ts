import { describe, expect, it } from "vitest";

import { parseBearerTokenMappings } from "../src/bearer-tokens.js";

describe("parseBearerTokenMappings", () => {
  it("parses JSON mappings and rejects duplicate tokens", () => {
    const map = parseBearerTokenMappings(
      JSON.stringify([
        { token: "opaque:token:with:colons", workspaceId: "ws-a" },
        { token: "other", workspaceId: "ws-b" },
      ]),
    );
    expect(map.get("opaque:token:with:colons")).toBe("ws-a");
    expect(map.get("other")).toBe("ws-b");

    expect(() =>
      parseBearerTokenMappings(
        JSON.stringify([
          { token: "dup", workspaceId: "ws-a" },
          { token: "dup", workspaceId: "ws-b" },
        ]),
      ),
    ).toThrow(/Duplicate bearer token/);
  });

  it("parses legacy comma mappings when JSON is not used", () => {
    const map = parseBearerTokenMappings("alpha:ws-a,beta:ws-b");
    expect(map.get("alpha")).toBe("ws-a");
    expect(map.get("beta")).toBe("ws-b");
  });

  it("rejects malformed legacy and JSON entries", () => {
    expect(() => parseBearerTokenMappings("not-json")).toThrow();
    expect(() => parseBearerTokenMappings("[{}]")).toThrow();
    expect(() => parseBearerTokenMappings("[]")).toThrow();
    expect(() => parseBearerTokenMappings(":ws-a")).toThrow();
  });
});
