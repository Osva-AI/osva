import { describe, expect, it } from "vitest";

import {
  extractGeneratedAnswer,
  validateRagEvidence,
} from "../src/rag-judge/evidence.js";

describe("extractGeneratedAnswer", () => {
  it("accepts non-empty string answers", () => {
    expect(extractGeneratedAnswer("Paris")).toBe("Paris");
  });

  it("accepts canonical numeric run output (jsonb round-trip)", () => {
    expect(extractGeneratedAnswer(4)).toBe("4");
  });

  it("rejects null and empty strings", () => {
    expect(extractGeneratedAnswer(null)).toBeNull();
    expect(extractGeneratedAnswer("")).toBeNull();
  });
});

describe("validateRagEvidence A3/A4 coexistence", () => {
  const caseInput = { prompt: "What is 2+2?" };

  it("LLM_JUDGE does not require A4 context for numeric target output", () => {
    const result = validateRagEvidence("LLM_JUDGE", caseInput, undefined, 4);
    expect(result).toEqual({
      ok: true,
      evidence: expect.objectContaining({
        generatedAnswer: "4",
      }),
    });
  });

  it("RAG_FAITHFULNESS still requires immutable context snapshot", () => {
    const result = validateRagEvidence(
      "RAG_FAITHFULNESS",
      caseInput,
      { schemaVersion: "a4.0" },
      "generated",
    );
    expect(result).toEqual({
      ok: false,
      errorCode: "rag_missing_context",
    });
  });

  it("missing mandatory generated output stays ERROR", () => {
    const result = validateRagEvidence(
      "RAG_ANSWER_RELEVANCE",
      caseInput,
      undefined,
      null,
    );
    expect(result).toEqual({
      ok: false,
      errorCode: "rag_missing_generated_answer",
    });
  });
});
