import { describe, expect, it } from "vitest";

import { buildEvaluationCaseRows } from "../src/client/components/evaluation/evaluation-case-results-table";

describe("buildEvaluationCaseRows", () => {
  const baseCase = {
    id: "case-1",
    evaluationSuiteVersionId: "ver-1",
    key: "alpha",
    input: { value: 1 },
    evaluator: { type: "JSON_EXACT_MATCH" as const, expected: { value: 1 } },
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("marks missing results as in progress while the run is active", () => {
    const rows = buildEvaluationCaseRows({
      cases: [baseCase],
      results: [],
      evaluationRunStatus: "RUNNING",
      summaryPendingCases: 1,
    });
    expect(rows[0]?.executionLabel).toBe("In progress");
    expect(rows[0]?.result).toBeUndefined();
  });

  it("joins completed case results by evaluationCaseId", () => {
    const rows = buildEvaluationCaseRows({
      cases: [baseCase],
      results: [
        {
          id: "result-1",
          evaluationRunId: "er-1",
          evaluationCaseId: "case-1",
          runId: "run-1",
          outcome: "PASS",
          evaluatorResults: { type: "JSON_EXACT_MATCH", passed: true },
          createdAt: "2026-01-01T00:01:00.000Z",
        },
      ],
      evaluationRunStatus: "COMPLETED",
      summaryPendingCases: 0,
    });
    expect(rows[0]?.executionLabel).toBe("Finished");
    expect(rows[0]?.result?.outcome).toBe("PASS");
  });
});
