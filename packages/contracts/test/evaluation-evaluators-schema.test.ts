import { describe, expect, it } from "vitest";

import { evaluatorConfigSchema } from "../src/schemas/evaluation.js";

describe("evaluatorConfigSchema", () => {
  it("accepts every A1 deterministic evaluator configuration", () => {
    const configs = [
      { type: "JSON_EXACT_MATCH", expected: { value: 1 } },
      {
        type: "TEXT_EXACT_MATCH",
        reference: "hello",
        caseSensitive: true,
        trimWhitespace: false,
      },
      { type: "TOKEN_F1", reference: "a b", minPassingScore: 0.75 },
      { type: "BLEU", reference: "the cat sat", minPassingScore: 0.1 },
      { type: "ROUGE_L", reference: "x y z" },
      { type: "JSON_VALID" },
      { type: "REQUIRED_CONCEPTS", concepts: ["refund"] },
      { type: "FORBIDDEN_CONCEPTS", concepts: ["ssn"] },
    ] as const;

    for (const config of configs) {
      expect(evaluatorConfigSchema.safeParse(config).success).toBe(true);
    }
  });

  it("accepts valid LLM_JUDGE configuration", () => {
    expect(
      evaluatorConfigSchema.safeParse({
        type: "LLM_JUDGE",
        rubric: "Score factual correctness from 0 to 1.",
        modelProfileVersionId: "model_profile_version_test",
      }).success,
    ).toBe(true);
  });

  it("accepts A4 RAG and semantic judge-backed evaluator configurations", () => {
    const modelProfileVersionId = "model_profile_version_test";
    const ragConfigs = [
      { type: "RAG_FAITHFULNESS", modelProfileVersionId },
      { type: "RAG_ANSWER_RELEVANCE", modelProfileVersionId },
      { type: "RAG_CONTEXT_PRECISION", modelProfileVersionId },
      { type: "RAG_CONTEXT_RECALL", modelProfileVersionId },
      {
        type: "SEMANTIC_SIMILARITY",
        modelProfileVersionId,
        minPassingScore: 0.8,
      },
    ] as const;

    for (const config of ragConfigs) {
      expect(evaluatorConfigSchema.safeParse(config).success).toBe(true);
    }
  });

  it("rejects unknown evaluator types", () => {
    expect(
      evaluatorConfigSchema.safeParse({
        type: "LLM_JUDGE_UNKNOWN",
        rubric: "x",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid thresholds and oversized references", () => {
    expect(
      evaluatorConfigSchema.safeParse({
        type: "TOKEN_F1",
        reference: "ok",
        minPassingScore: Number.NaN,
      }).success,
    ).toBe(false);

    expect(
      evaluatorConfigSchema.safeParse({
        type: "TEXT_EXACT_MATCH",
        reference: "",
      }).success,
    ).toBe(false);

    expect(
      evaluatorConfigSchema.safeParse({
        type: "REQUIRED_CONCEPTS",
        concepts: [],
      }).success,
    ).toBe(false);
  });

  it("preserves JSON_EXACT_MATCH shape", () => {
    const parsed = evaluatorConfigSchema.parse({
      type: "JSON_EXACT_MATCH",
      expected: [1, 2, 3],
    });
    expect(parsed).toEqual({
      type: "JSON_EXACT_MATCH",
      expected: [1, 2, 3],
    });
  });
});
