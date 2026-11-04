import { describe, expect, it } from "vitest";

import {
  evaluationRunGateHint,
  formatEvaluationRunStatusLabel,
  formatEvaluationTargetSummary,
} from "../src/client/lib/testing-resource-presentation";

describe("testing-resource-presentation", () => {
  it("formats run lifecycle labels", () => {
    expect(formatEvaluationRunStatusLabel("COMPLETED")).toBe("Completed");
    expect(formatEvaluationRunStatusLabel("RUNNING")).toBe("Running");
  });

  it("does not imply gate pass from completed lifecycle", () => {
    expect(evaluationRunGateHint("COMPLETED")).toMatch(/gate verdict/i);
    expect(evaluationRunGateHint("RUNNING")).toMatch(/after run completes/i);
  });

  it("summarizes evaluation targets", () => {
    expect(
      formatEvaluationTargetSummary({
        id: "er-1",
        workspaceId: "ws-1",
        evaluationSuiteVersionId: "esv-1",
        targetType: "AGENT_VERSION",
        targetVersionId: "av-1",
        status: "COMPLETED",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("Agent version");
  });
});
