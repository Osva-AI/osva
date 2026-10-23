import { describe, expect, it } from "vitest";

import { EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION } from "../src/evaluation-quality-gate.js";
import { evaluationQualityGatePolicySchema } from "../src/schemas/evaluation-quality-gate.js";
import {
  createEvaluationRunRequestSchema,
  evaluationRunDetailResourceSchema,
} from "../src/schemas/evaluation-suite.js";

describe("evaluationQualityGatePolicySchema", () => {
  it("accepts a valid policy and rejects duplicates", () => {
    const valid = evaluationQualityGatePolicySchema.safeParse({
      schemaVersion: EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
      rules: [
        { metric: "PASS_RATE", operator: "MIN", threshold: 0.8 },
        { metric: "ERROR_COUNT", operator: "MAX", threshold: 0 },
      ],
    });
    expect(valid.success).toBe(true);

    const duplicate = evaluationQualityGatePolicySchema.safeParse({
      schemaVersion: EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
      rules: [
        { metric: "PASS_RATE", operator: "MIN", threshold: 1 },
        { metric: "PASS_RATE", operator: "MIN", threshold: 0.5 },
      ],
    });
    expect(duplicate.success).toBe(false);
  });
});

describe("evaluation run API schemas", () => {
  it("allows optional qualityGatePolicy on create and qualityGate on detail", () => {
    const create = createEvaluationRunRequestSchema.safeParse({
      evaluationSuiteVersionId: "esv_abc",
      targetType: "AGENT_VERSION",
      targetVersionId: "agv_abc",
      qualityGatePolicy: {
        schemaVersion: 1,
        rules: [{ metric: "PASS_RATE", operator: "MIN", threshold: 1 }],
      },
    });
    expect(create.success).toBe(true);

    const detail = evaluationRunDetailResourceSchema.safeParse({
      id: "er_abc",
      workspaceId: "ws_abc",
      evaluationSuiteVersionId: "esv_abc",
      targetType: "AGENT_VERSION",
      targetVersionId: "agv_abc",
      status: "RUNNING",
      createdAt: "2026-01-01T00:00:00.000Z",
      summary: {
        totalCases: 1,
        pendingCases: 0,
        runningCases: 1,
        completedCases: 0,
        passedCases: 0,
        failedCases: 0,
        errorCases: 0,
        passRate: 0,
        completionCoverage: 0,
        validScoredCaseCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        pricedCostUsdMicros: 0,
        unpricedModelCalls: 0,
        usageMeasured: false,
      },
      qualityGate: {
        policy: {
          schemaVersion: 1,
          rules: [{ metric: "PASS_RATE", operator: "MIN", threshold: 1 }],
        },
        assessment: {
          schemaVersion: 1,
          overallVerdict: "INDETERMINATE",
          lifecycleVerdict: "INDETERMINATE",
          ruleResults: [],
          assessedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    expect(detail.success).toBe(true);
  });
});
