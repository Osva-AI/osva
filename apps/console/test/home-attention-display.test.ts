import { describe, expect, it } from "vitest";

import { homeAttentionStatusLabel } from "../src/client/lib/home-attention-display";

describe("homeAttentionStatusLabel", () => {
  it("maps FAILED to Failed", () => {
    expect(homeAttentionStatusLabel("FAILED")).toBe("Failed");
  });

  it("maps TIMED_OUT to Timed out", () => {
    expect(homeAttentionStatusLabel("TIMED_OUT")).toBe("Timed out");
  });
});
