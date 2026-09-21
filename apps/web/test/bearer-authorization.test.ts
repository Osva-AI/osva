import { describe, expect, it } from "vitest";

import { parseBearerAuthorization } from "../src/bearer-authorization.js";

describe("parseBearerAuthorization", () => {
  it("extracts bearer tokens and rejects malformed headers", () => {
    expect(parseBearerAuthorization(undefined)).toBeUndefined();
    expect(parseBearerAuthorization("Basic abc")).toBeUndefined();
    expect(parseBearerAuthorization("Bearer")).toBeUndefined();
    expect(parseBearerAuthorization("Bearer   ")).toBeUndefined();
    expect(parseBearerAuthorization("Bearer osva_ak_id.secret")).toBe(
      "osva_ak_id.secret",
    );
  });
});
