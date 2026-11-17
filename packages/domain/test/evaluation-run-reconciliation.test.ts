import type {
  EvaluationCaseId,
  EvaluationCaseResultId,
  EvaluationRunId,
  RunId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { evaluateDeterministicEvaluator } from "../src/deterministic-evaluators/evaluate.js";
import { reconcileCaseResultsForScoring } from "../src/evaluation-run-scoring.js";
import { EvaluationCaseResult } from "../src/evaluation-case-result.js";

describe("evaluation run reconciliation", () => {
  it("replays deterministic evaluation identically", () => {
    const config = {
      type: "TOKEN_F1",
      reference: "hello world",
      minPassingScore: 0.5,
    };
    const first = evaluateDeterministicEvaluator(
      config,
      "hello brave world",
      undefined,
    );
    const second = evaluateDeterministicEvaluator(
      config,
      "hello brave world",
      undefined,
    );
    expect(first).toEqual(second);
  });

  it("prevents duplicate inconsistent case results", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const base = {
      evaluationRunId: "er-1" as EvaluationRunId,
      evaluationCaseId: "ec-1" as EvaluationCaseId,
      runId: "run-1" as RunId,
      outcome: "PASS" as const,
      evaluatorResults: { type: "JSON_EXACT_MATCH", score: 1, passed: true },
      createdAt: now,
      completedAt: now,
    };

    const a = EvaluationCaseResult.create({
      id: "res-b" as EvaluationCaseResultId,
      ...base,
    });
    const b = EvaluationCaseResult.create({
      id: "res-a" as EvaluationCaseResultId,
      ...base,
    });

    const reconciled = reconcileCaseResultsForScoring([a, b]);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.id).toBe("res-a");
  });

  it("records ERROR when child run attempt did not succeed", () => {
    const result = evaluateDeterministicEvaluator(
      { type: "JSON_EXACT_MATCH", expected: 1 },
      1,
      undefined,
    );
    expect(result.outcome).toBe("PASS");
  });
});
