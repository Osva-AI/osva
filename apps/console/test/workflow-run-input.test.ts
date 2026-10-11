import { describe, expect, it } from "vitest";

import { parseWorkflowRunInputJson } from "../src/client/lib/workflow-run-input";

describe("parseWorkflowRunInputJson", () => {
  it("accepts empty-object JSON", () => {
    expect(parseWorkflowRunInputJson("{}")).toEqual({
      ok: true,
      value: {},
    });
  });

  it("rejects empty input before submission", () => {
    expect(parseWorkflowRunInputJson("   ")).toEqual({
      ok: false,
      message: "Run input is required. Use {} for empty input.",
    });
  });

  it("rejects malformed JSON with the parser message", () => {
    const parsed = parseWorkflowRunInputJson("{not-json");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("expected parse failure");
    }
    expect(parsed.message.length).toBeGreaterThan(0);
  });

  it("parses nested JSON values", () => {
    expect(parseWorkflowRunInputJson('{"invoiceId":"inv-1","n":1}')).toEqual({
      ok: true,
      value: { invoiceId: "inv-1", n: 1 },
    });
  });
});
