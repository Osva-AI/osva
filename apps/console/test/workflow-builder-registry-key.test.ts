import { describe, expect, it } from "vitest";

import { slugWorkflowKeyFromName } from "../src/client/lib/workflow-builder-registry-key";

describe("slugWorkflowKeyFromName", () => {
  it("slugifies display names for registry keys", () => {
    expect(slugWorkflowKeyFromName("  Customer Review Flow  ")).toBe(
      "customer-review-flow",
    );
    expect(slugWorkflowKeyFromName("")).toBe("new-workflow");
  });
});
