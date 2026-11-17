import { describe, expect, it } from "vitest";

import {
  evaluateDeterministicEvaluator,
  exactMatchText,
  rougeLScore,
  sentenceBleuScore,
  tokenF1Score,
  tokenizeForMetrics,
} from "../src/deterministic-evaluators/index.js";
import { EVALUATOR_ROUGE_L_MAX_TOKENS } from "@osva-ai/contracts";

describe("deterministic evaluator registry", () => {
  it("preserves JSON_EXACT_MATCH pass and fail semantics", () => {
    const config = { type: "JSON_EXACT_MATCH", expected: { n: 1 } };
    const pass = evaluateDeterministicEvaluator(config, { n: 1 }, undefined);
    expect(pass).toMatchObject({
      outcome: "PASS",
      evaluatorResults: { type: "JSON_EXACT_MATCH", score: 1, passed: true },
    });

    const fail = evaluateDeterministicEvaluator(config, { n: 2 }, undefined);
    expect(fail).toMatchObject({
      outcome: "FAIL",
      evaluatorResults: { type: "JSON_EXACT_MATCH", score: 0, passed: false },
    });
  });

  it("uses case expected fallback for JSON_EXACT_MATCH", () => {
    const result = evaluateDeterministicEvaluator(
      { type: "JSON_EXACT_MATCH", expected: { a: 1 } },
      { a: 1 },
      { a: 2 },
    );
    expect(result.outcome).toBe("PASS");
  });

  it("TEXT_EXACT_MATCH respects case and whitespace options", () => {
    const config = {
      type: "TEXT_EXACT_MATCH",
      reference: "Hi",
      caseSensitive: true,
      trimWhitespace: true,
    };
    expect(
      evaluateDeterministicEvaluator(config, " Hi ", undefined).outcome,
    ).toBe("PASS");
    expect(
      evaluateDeterministicEvaluator(config, "hi", undefined).outcome,
    ).toBe("FAIL");
  });

  it("TEXT_EXACT_MATCH defaults to case-insensitive trimmed match", () => {
    const outcome = evaluateDeterministicEvaluator(
      { type: "TEXT_EXACT_MATCH", reference: "Hello" },
      "  hello ",
      undefined,
    );
    expect(outcome.outcome).toBe("PASS");
  });

  it("TOKEN_F1 uses multiset overlap and fractional scoring", () => {
    const config = {
      type: "TOKEN_F1",
      reference: "a a b",
      minPassingScore: 0.9,
    };
    const result = evaluateDeterministicEvaluator(config, "a b", undefined);
    expect(result.outcome).toBe("FAIL");
    expect(result.evaluatorResults.score).toBeCloseTo(0.8, 5);
    expect(typeof result.evaluatorResults.score).toBe("number");
  });

  it("BLEU applies brevity penalty on short candidates", () => {
    const short = sentenceBleuScore("a", "a a a a");
    const full = sentenceBleuScore("a a a a", "a a a a");
    expect(short).toBeLessThan(full);
    expect(short).toBeLessThan(0.1);
    const config = { type: "BLEU", reference: "the cat sat on the mat" };
    const bleu = evaluateDeterministicEvaluator(
      config,
      "the cat sat on the mat",
      undefined,
    );
    expect(bleu.outcome).toBe("PASS");
    expect(bleu.evaluatorResults.score).toBeGreaterThan(0.9);
  });

  it("ROUGE_L scores partial overlap", () => {
    const score = rougeLScore("a b c", "a b d");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("ROUGE-L rejects oversized token inputs", () => {
    const longText = Array.from(
      { length: EVALUATOR_ROUGE_L_MAX_TOKENS },
      () => "tok",
    ).join(" ");
    const result = evaluateDeterministicEvaluator(
      { type: "ROUGE_L", reference: "x" },
      longText,
      undefined,
    );
    expect(result.outcome).toBe("ERROR");
    expect(result.evaluatorResults).toMatchObject({
      errorCode: "input_too_large",
    });
  });

  it("JSON_VALID accepts canonical structured output", () => {
    const result = evaluateDeterministicEvaluator(
      { type: "JSON_VALID" },
      { ok: true },
      undefined,
    );
    expect(result.outcome).toBe("PASS");
  });

  it("JSON_VALID rejects prose-wrapped JSON strings", () => {
    const invalid = evaluateDeterministicEvaluator(
      { type: "JSON_VALID" },
      'prefix {"a":1}',
      undefined,
    );
    expect(invalid.outcome).toBe("FAIL");

    const valid = evaluateDeterministicEvaluator(
      { type: "JSON_VALID" },
      '{"a":1}',
      undefined,
    );
    expect(valid.outcome).toBe("PASS");
  });

  it("required and forbidden concept evaluators normalize text", () => {
    const required = evaluateDeterministicEvaluator(
      {
        type: "REQUIRED_CONCEPTS",
        concepts: ["Refund"],
        minPassingScore: 0.5,
      },
      "Your REFUND is approved",
      undefined,
    );
    expect(required.outcome).toBe("PASS");
    expect(required.evaluatorResults.matchedConceptCount).toBe(1);

    const forbidden = evaluateDeterministicEvaluator(
      { type: "FORBIDDEN_CONCEPTS", concepts: ["secret"] },
      "no leaks here",
      undefined,
    );
    expect(forbidden.outcome).toBe("PASS");

    const leaked = evaluateDeterministicEvaluator(
      { type: "FORBIDDEN_CONCEPTS", concepts: ["secret"] },
      "contains secret value",
      undefined,
    );
    expect(leaked.outcome).toBe("FAIL");
    expect(leaked.evaluatorResults.forbiddenConceptHitCount).toBe(1);
    expect(leaked.evaluatorResults).not.toHaveProperty("matchedContent");
  });

  it("returns ERROR for incompatible output types", () => {
    const result = evaluateDeterministicEvaluator(
      { type: "TEXT_EXACT_MATCH", reference: "x" },
      { not: "text" },
      undefined,
    );
    expect(result.outcome).toBe("ERROR");
    expect(result.evaluatorResults.errorCode).toBe("incompatible_output_type");
  });

  it("returns ERROR for invalid config and unsupported types", () => {
    const badConfig = evaluateDeterministicEvaluator(
      { type: "TOKEN_F1", reference: 12 },
      "text",
      undefined,
    );
    expect(badConfig.outcome).toBe("ERROR");
    expect(badConfig.evaluatorResults.status).toBe("INVALID_CONFIG");
  });

  it("metrics are repeatable", () => {
    const candidate = "the quick brown fox";
    const reference = "the quick brown dog";
    expect(tokenF1Score(candidate, reference)).toBe(
      tokenF1Score(candidate, reference),
    );
    expect(tokenizeForMetrics("  A  B ")).toEqual(["a", "b"]);
    expect(exactMatchText("x", "X", false, true)).toBe(true);
  });
});
