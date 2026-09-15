import { describe, expect, it } from "vitest";

import { modelRequestSchema } from "../src/schemas/model-gateway.js";

const validRequest = {
  modelProfileVersionId: "model-profile-version-1",
  instructions: "Answer briefly.",
  input: { prompt: "hello" },
  timeoutMs: 10_000,
  metadata: {},
};

describe("Model request", () => {
  it("requires ModelProfileVersionId", () => {
    const withoutVersion: Record<string, unknown> = { ...validRequest };
    delete withoutVersion.modelProfileVersionId;
    const parsed = modelRequestSchema.safeParse(withoutVersion);
    expect(parsed.success).toBe(false);
  });

  it("parses a request bound to a ModelProfileVersion", () => {
    const parsed = modelRequestSchema.parse(validRequest);
    expect(parsed.modelProfileVersionId).toBe("model-profile-version-1");
  });
});
