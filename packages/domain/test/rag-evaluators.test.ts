import { describe, expect, it } from "vitest";

import {
  averagePrecisionOverRankedChunks,
  scoreContextRecallFromFacts,
  scoreFaithfulnessFromClaims,
} from "../src/rag-judge/scoring.js";
import {
  parseContextPrecisionVerdictJson,
  parseContextRecallVerdictJson,
  parseFaithfulnessVerdictJson,
} from "../src/rag-judge/verdicts.js";

describe("RAG evaluator scoring", () => {
  it("computes faithfulness from supported claims", () => {
    expect(
      scoreFaithfulnessFromClaims([
        { supported: true },
        { supported: false },
        { supported: true },
      ]),
    ).toBeCloseTo(2 / 3);
    expect(scoreFaithfulnessFromClaims([])).toBeNull();
  });

  it("computes AP-style context precision", () => {
    expect(averagePrecisionOverRankedChunks([true, false, true])).toBeCloseTo(
      (1 + 2 / 3) / 2,
    );
    expect(averagePrecisionOverRankedChunks([false, false])).toBe(0);
    expect(averagePrecisionOverRankedChunks([true, true])).toBe(1);
  });

  it("computes context recall", () => {
    expect(
      scoreContextRecallFromFacts([{ supported: true }, { supported: false }]),
    ).toBe(0.5);
  });

  it("parses faithfulness verdict and rejects unknown chunk ids", () => {
    const allowed = new Set(["c1", "c2"]);
    const ok = parseFaithfulnessVerdictJson(
      JSON.stringify({
        reason: "ok",
        claims: [
          {
            id: "a1",
            statement: "Fact",
            supported: true,
            supportingChunkIds: ["c1"],
          },
        ],
      }),
      allowed,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.score).toBe(1);
    }

    const bad = parseFaithfulnessVerdictJson(
      JSON.stringify({
        reason: "bad",
        claims: [
          {
            id: "a1",
            statement: "Fact",
            supported: true,
            supportingChunkIds: ["missing"],
          },
        ],
      }),
      allowed,
    );
    expect(bad.ok).toBe(false);
  });

  it("parses context precision with full chunk coverage", () => {
    const parsed = parseContextPrecisionVerdictJson(
      JSON.stringify({
        reason: "ranked",
        chunkAssessments: [
          { chunkId: "c1", relevant: true },
          { chunkId: "c2", relevant: false },
        ],
      }),
      ["c1", "c2"],
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.score).toBeCloseTo(1);
    }
  });

  it("parses recall and enforces expected fact ids", () => {
    const parsed = parseContextRecallVerdictJson(
      JSON.stringify({
        reason: "recall",
        facts: [
          { id: "f1", statement: "A", supported: true },
          { id: "f2", statement: "B", supported: false },
        ],
      }),
      new Set(["x"]),
      ["f1", "f2"],
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.score).toBe(0.5);
    }
  });
});
