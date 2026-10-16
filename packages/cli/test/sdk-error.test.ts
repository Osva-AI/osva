import { describe, expect, it } from "vitest";

import { OsvaApiError, OsvaTransportError } from "@osva-ai/sdk";

import { mapProjectSdkError } from "../src/project/sdk-error.js";

describe("mapProjectSdkError", () => {
  it("returns JSON on stdout for API errors when --json", () => {
    const mapped = mapProjectSdkError({
      json: true,
      error: new OsvaApiError(
        401,
        { status: "error", code: "UNAUTHORIZED" },
        "req-1",
      ),
    });
    expect(mapped?.ok).toBe(false);
    expect(mapped?.stdout).toContain('"kind": "api"');
    expect(mapped?.stdout).toContain("UNAUTHORIZED");
    expect(mapped?.stdout).not.toMatch(/osva_ak_/);
  });

  it("returns human message without leaking api keys", () => {
    const mapped = mapProjectSdkError({
      json: false,
      error: new OsvaTransportError("OSVA API request timed out."),
    });
    expect(mapped?.message).toContain("timed out");
  });
});
