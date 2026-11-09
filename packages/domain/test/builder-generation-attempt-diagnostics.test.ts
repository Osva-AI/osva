import { describe, expect, it } from "vitest";

import {
  sanitizeCompileIssuesForEvidence,
  validationStageForErrorCode,
} from "../src/builder/builder-generation-attempt-diagnostics.js";
import { builderIssue } from "../src/builder/builder-issue.js";

describe("builder generation attempt diagnostics", () => {
  it("maps compiler failures to pre_publication_compile stage", () => {
    expect(validationStageForErrorCode("INVALID_COMPILED_PROPOSAL")).toBe(
      "pre_publication_compile",
    );
  });

  it("sanitizes compile issues to bounded evidence", () => {
    const issues = [
      builderIssue({
        code: "INVALID_GRAPH_TOPOLOGY",
        message: "Disallowed cycle between a and b.",
        action: "Fix workflow graph.",
        location: { kind: "workflow_edge", from: "a", to: "b" },
      }),
    ];
    const sanitized = sanitizeCompileIssuesForEvidence(issues);
    expect(sanitized).toHaveLength(1);
    expect(sanitized![0]).toMatchObject({
      code: "INVALID_GRAPH_TOPOLOGY",
      severity: "error",
      edgeFrom: "a",
      edgeTo: "b",
      messagePreview: expect.stringContaining("cycle"),
    });
  });
});
