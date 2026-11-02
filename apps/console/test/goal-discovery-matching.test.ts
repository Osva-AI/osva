import { describe, expect, it } from "vitest";

import {
  GOAL_MATCH_MIN_RELIABLE_SCORE,
  matchGoalToExamples,
  normalizeGoalText,
  tokenizeGoal,
} from "../src/client/lib/goal-discovery-matching";

describe("goal discovery matching", () => {
  it("normalizes case and punctuation", () => {
    expect(normalizeGoalText("  Create an SEO Audit!!!  ")).toBe(
      "create an seo audit",
    );
  });

  it("drops stop words when tokenizing", () => {
    expect(tokenizeGoal("What would you like AI to do for SEO?")).toContain(
      "seo",
    );
    expect(tokenizeGoal("What would you like AI to do for SEO?")).not.toContain(
      "would",
    );
  });

  it("ranks SEO goals toward the SEO worker", () => {
    const result = matchGoalToExamples("create an SEO audit");
    expect(result.matches[0]?.exampleId).toBe("04-seo-worker");
    expect(result.hasReliableMatch).toBe(true);
    expect(result.matches[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("maps customer support language to the support worker", () => {
    const result = matchGoalToExamples("automate customer support tickets");
    expect(
      result.matches.some((m) => m.exampleId === "06-customer-support-worker"),
    ).toBe(true);
  });

  it("maps approval workflow language to durable review", () => {
    const result = matchGoalToExamples(
      "build an approval workflow with events",
    );
    expect(result.matches[0]?.exampleId).toBe("03-durable-review-workflow");
  });

  it("returns empty matches for whitespace-only input", () => {
    const result = matchGoalToExamples("   ");
    expect(result.matches).toEqual([]);
    expect(result.hasReliableMatch).toBe(false);
  });

  it("does not claim reliable matches for irrelevant queries", () => {
    const result = matchGoalToExamples("quantum blockchain pizza");
    expect(result.hasReliableMatch).toBe(false);
    if (result.matches.length > 0) {
      expect(result.matches[0]?.score).toBeLessThan(
        GOAL_MATCH_MIN_RELIABLE_SCORE,
      );
    }
  });

  it("uses stable tie ordering by example id", () => {
    const first = matchGoalToExamples("agent run execute");
    const second = matchGoalToExamples("agent run execute");
    expect(first.matches.map((m) => m.exampleId)).toEqual(
      second.matches.map((m) => m.exampleId),
    );
  });

  it("still surfaces the best example for short single-token queries", () => {
    const seo = matchGoalToExamples("seo");
    expect(seo.matches[0]?.exampleId).toBe("04-seo-worker");
    expect(seo.hasReliableMatch).toBe(true);

    const rag = matchGoalToExamples("rag");
    expect(rag.matches[0]?.exampleId).toBe("16-knowledge-rag-agent");
  });

  it("prefers the more specific growth example when keywords overlap", () => {
    const analyst = matchGoalToExamples("growth funnel metrics");
    expect(analyst.matches[0]?.exampleId).toBe("07-growth-analyst-worker");
    expect(analyst.hasReliableMatch).toBe(true);

    const ops = matchGoalToExamples("growth operations multi source");
    expect(ops.matches[0]?.exampleId).toBe("11-growth-operations-worker");
  });

  it("returns no matches for empty tokenization", () => {
    expect(matchGoalToExamples("!!!").matches).toEqual([]);
  });
});
