import { describe, expect, it } from "vitest";

import {
  consensusHumanDecisionByCase,
  filterNonSupersededHumanReviews,
} from "../src/comparison/human-review-effective.js";

describe("human review effective selection", () => {
  it("filters superseded revisions", () => {
    const effective = filterNonSupersededHumanReviews([
      {
        id: "rev-1" as never,
        workspaceId: "ws-1" as never,
        comparisonId: "cmp-1" as never,
        evaluationCaseId: "ec-1" as never,
        reviewerUserId: "user-1" as never,
        decision: "TIE",
        evidenceReference: "rubric-1",
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "rev-2" as never,
        workspaceId: "ws-1" as never,
        comparisonId: "cmp-1" as never,
        evaluationCaseId: "ec-1" as never,
        reviewerUserId: "user-1" as never,
        decision: "CANDIDATE_BETTER",
        evidenceReference: "rubric-1",
        supersedesRevisionId: "rev-1" as never,
        createdAt: new Date("2026-01-02"),
      },
    ]);
    expect(effective.map((r) => r.id)).toEqual(["rev-2"]);
  });

  it("omits cases with conflicting reviewer decisions", () => {
    const consensus = consensusHumanDecisionByCase([
      {
        id: "rev-1" as never,
        workspaceId: "ws-1" as never,
        comparisonId: "cmp-1" as never,
        evaluationCaseId: "ec-1" as never,
        reviewerUserId: "user-1" as never,
        decision: "BASELINE_BETTER",
        evidenceReference: "rubric-1",
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "rev-2" as never,
        workspaceId: "ws-1" as never,
        comparisonId: "cmp-1" as never,
        evaluationCaseId: "ec-1" as never,
        reviewerUserId: "user-2" as never,
        decision: "CANDIDATE_BETTER",
        evidenceReference: "rubric-1",
        createdAt: new Date("2026-01-01"),
      },
    ]);
    expect(consensus.size).toBe(0);
  });
});
