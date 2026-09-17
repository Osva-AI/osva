import { describe, expect, it } from "vitest";

import { selectBranchTarget } from "../src/workflow-branch.js";

const node = {
  key: "route",
  type: "BRANCH" as const,
  selector: "/category",
  cases: [
    { equals: "sales" as const, to: "sales" },
    { equals: "support" as const, to: "support" },
    { equals: 7 as const, to: "sales" },
    { equals: true as const, to: "support" },
    { equals: null, to: "support" },
  ],
  defaultTo: "general",
};

describe("BRANCH selection", () => {
  it("selects an exact primitive match", () => {
    expect(selectBranchTarget(node, { category: "sales" })).toBe("sales");
    expect(selectBranchTarget(node, { category: 7 })).toBe("sales");
    expect(selectBranchTarget(node, { category: true })).toBe("support");
    expect(selectBranchTarget(node, { category: null })).toBe("support");
  });

  it("uses the default path when the selector is missing or unmatched", () => {
    expect(selectBranchTarget(node, {})).toBe("general");
    expect(selectBranchTarget(node, { category: "other" })).toBe("general");
    expect(selectBranchTarget(node, { category: { nested: true } })).toBe(
      "general",
    );
  });
});
