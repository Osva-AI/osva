import { describe, expect, it } from "vitest";

import {
  describeWorkflowRunInputSyntax,
  parseWorkflowRunInputJson,
} from "../src/client/lib/workflow-run-input";

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

describe("describeWorkflowRunInputSyntax", () => {
  const valid = parseWorkflowRunInputJson("{}");

  it("does not treat valid JSON as contract-valid input", () => {
    const notice = describeWorkflowRunInputSyntax(valid, {
      status: "available",
      nodeKey: "research",
      agentVersionId: "av-research",
      agentId: "agent-research",
      schema: {
        type: "object",
        required: ["schemaVersion"],
        properties: { schemaVersion: { const: "1" } },
      },
    });
    expect(notice.kind).toBe("info");
    expect(notice.message).toMatch(
      /does not mean the first agent will accept/i,
    );
  });

  it("preserves empty-object contracts as valid executable input", () => {
    const notice = describeWorkflowRunInputSyntax(valid, {
      status: "available",
      nodeKey: "echo",
      agentVersionId: "av-echo",
      agentId: "agent-echo",
      schema: { type: "object" },
    });
    expect(notice.message).toMatch(/accepts empty-object input/i);
  });

  it("explains unavailable schemas without blocking syntax-valid JSON", () => {
    const notice = describeWorkflowRunInputSyntax(valid, {
      status: "schema_unavailable",
      nodeKey: "research",
      agentVersionId: "av-missing",
      reason: "version_not_found",
    });
    expect(notice.kind).toBe("info");
    expect(notice.message).toMatch(/schema is unavailable/i);
  });
});
