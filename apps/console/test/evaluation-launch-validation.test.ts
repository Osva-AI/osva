import { describe, expect, it } from "vitest";

import { validateEvaluationLaunchDraft } from "../src/client/lib/evaluation-launch-validation";

describe("evaluation launch validation", () => {
  it("requires all selections and at least one case", () => {
    expect(
      validateEvaluationLaunchDraft({
        evaluationSuiteId: "",
        evaluationSuiteVersionId: "",
        agentId: "",
        agentVersionId: "",
        caseCount: 0,
      }).map((issue) => issue.field),
    ).toEqual([
      "evaluationSuiteId",
      "evaluationSuiteVersionId",
      "agentId",
      "agentVersionId",
    ]);

    expect(
      validateEvaluationLaunchDraft({
        evaluationSuiteId: "suite-1",
        evaluationSuiteVersionId: "ver-1",
        agentId: "agent-1",
        agentVersionId: "av-1",
        caseCount: 0,
      }),
    ).toEqual([
      {
        field: "cases",
        message: "The selected suite version has no test cases.",
      },
    ]);
  });

  it("accepts a complete draft", () => {
    expect(
      validateEvaluationLaunchDraft({
        evaluationSuiteId: "suite-1",
        evaluationSuiteVersionId: "ver-1",
        agentId: "agent-1",
        agentVersionId: "av-1",
        caseCount: 2,
      }),
    ).toEqual([]);
  });
});
