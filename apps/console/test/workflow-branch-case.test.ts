import { describe, expect, it } from "vitest";

import {
  branchCaseValueKind,
  formatBranchCaseForInput,
  parseBranchCaseInput,
} from "../src/client/lib/workflow-branch-case";

describe("workflow branch case typing", () => {
  it("round-trips string, number, boolean, and null", () => {
    expect(branchCaseValueKind("ok")).toBe("string");
    expect(branchCaseValueKind(42)).toBe("number");
    expect(branchCaseValueKind(true)).toBe("boolean");
    expect(branchCaseValueKind(null)).toBe("null");

    expect(parseBranchCaseInput("hello", "string")).toBe("hello");
    expect(parseBranchCaseInput("3.5", "number")).toBe(3.5);
    expect(parseBranchCaseInput("true", "boolean")).toBe(true);
    expect(parseBranchCaseInput("", "null")).toBe(null);
  });

  it("formats values for editor inputs", () => {
    expect(formatBranchCaseForInput(null)).toBe("");
    expect(formatBranchCaseForInput(false)).toBe("false");
    expect(formatBranchCaseForInput(7)).toBe("7");
  });
});
