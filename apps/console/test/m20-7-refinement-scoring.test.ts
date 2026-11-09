import type { ModelProfileVersionId } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  baseProposal,
  minimalNewAgent,
} from "../../../packages/domain/test/builder-natural-language-test-helpers.js";
import type { BuilderProposalV1 } from "@osva/domain/builder";

import {
  deriveM20_7OverallStatus,
  deriveScenarioStatus,
  liveAcceptanceShouldExitNonZero,
  scoreLiveRefinement,
} from "./integration/m20-7-live-eval.js";

const mpv = "mpv-test" as ModelProfileVersionId;

function summarizer(ref = "bpr_sum" as const) {
  return {
    ...minimalNewAgent(ref),
    model: { bindingName: "default", modelProfileVersionId: mpv },
    instructions:
      "Summarize weekly feedback. Identify recurring themes and produce actionable recommendations.",
  };
}

function factChecker(ref = "bpr_fc" as const) {
  return {
    ...minimalNewAgent(ref),
    agentKey: "fact-check",
    model: { bindingName: "default", modelProfileVersionId: mpv },
    instructions:
      "Fact-check the summarizer recommendations for accuracy before output.",
  };
}

const smokeExpectations = {
  minAddedAgents: 1,
  preserveSummarizerInstructions: true,
  requireFactCheckSemantics: true,
};

const smokeRubric = [
  "refinement_accuracy",
  "ordered_dependencies",
  "stable_refs",
  "fact_check_after_summarizer",
] as const;

describe("M20.7.2 refinement scoring", () => {
  it("1: valid generation base followed by valid refinement scores 2", () => {
    const base: BuilderProposalV1 = {
      ...baseProposal({
        agents: [summarizer()],
        workflow: {
          nodes: [{ key: "summarize", type: "AGENT", agentRef: "bpr_sum" }],
          edges: [],
        },
      }),
    };
    const refined: BuilderProposalV1 = {
      ...base,
      agents: [summarizer(), factChecker()],
      workflow: {
        nodes: [
          { key: "summarize", type: "AGENT", agentRef: "bpr_sum" },
          { key: "verify_output", type: "AGENT", agentRef: "bpr_fc" },
        ],
        edges: [{ from: "summarize", to: "verify_output" }],
      },
    };
    const score = scoreLiveRefinement(
      base,
      refined,
      undefined,
      smokeExpectations,
      smokeRubric,
    );
    expect(score.score).toBe(2);
    expect(score.reasons).toEqual([]);
  });

  it("2: missing fact-checking agent scores low", () => {
    const base = baseProposal({ agents: [summarizer()] });
    const score = scoreLiveRefinement(
      base,
      base,
      undefined,
      smokeExpectations,
      smokeRubric,
    );
    expect(score.score).toBeLessThan(2);
    expect(score.reasons).toContain("missing_added_agent");
  });

  it("3: summarizer instructions drift fails", () => {
    const base = baseProposal({ agents: [summarizer()] });
    const drifted = summarizer();
    const refined: BuilderProposalV1 = {
      ...base,
      agents: [
        { ...drifted, instructions: "Completely different task." },
        factChecker(),
      ],
      workflow: {
        nodes: [
          { key: "summarize", type: "AGENT", agentRef: "bpr_sum" },
          { key: "verify", type: "AGENT", agentRef: "bpr_fc" },
        ],
        edges: [{ from: "summarize", to: "verify" }],
      },
    };
    const score = scoreLiveRefinement(
      base,
      refined,
      undefined,
      smokeExpectations,
      smokeRubric,
    );
    expect(score.reasons).toContain("summarizer_instructions_drift");
  });

  it("4: new agent exists but is not connected in the workflow", () => {
    const base = baseProposal({ agents: [summarizer()] });
    const refined: BuilderProposalV1 = {
      ...base,
      agents: [summarizer(), factChecker()],
      workflow: {
        nodes: [{ key: "summarize", type: "AGENT", agentRef: "bpr_sum" }],
        edges: [],
      },
    };
    const score = scoreLiveRefinement(
      base,
      refined,
      undefined,
      smokeExpectations,
      smokeRubric,
    );
    expect(score.reasons).toContain("fact_check_not_connected");
  });

  it("5: renamed node keys still pass when graph order is correct", () => {
    const base = baseProposal({ agents: [summarizer()] });
    const refined: BuilderProposalV1 = {
      ...base,
      agents: [summarizer(), factChecker()],
      workflow: {
        nodes: [
          { key: "weekly_digest", type: "AGENT", agentRef: "bpr_sum" },
          { key: "quality_gate", type: "AGENT", agentRef: "bpr_fc" },
        ],
        edges: [{ from: "weekly_digest", to: "quality_gate" }],
      },
    };
    const score = scoreLiveRefinement(
      base,
      refined,
      undefined,
      smokeExpectations,
      smokeRubric,
    );
    expect(score.score).toBe(2);
  });

  it("6: does not require fact-check words in terminal node key (prior bug)", () => {
    const base = baseProposal({ agents: [summarizer()] });
    const refined: BuilderProposalV1 = {
      ...base,
      agents: [summarizer(), factChecker()],
      workflow: {
        nodes: [
          { key: "step_one", type: "AGENT", agentRef: "bpr_sum" },
          { key: "step_two", type: "AGENT", agentRef: "bpr_fc" },
        ],
        edges: [{ from: "step_one", to: "step_two" }],
      },
    };
    const score = scoreLiveRefinement(
      base,
      refined,
      undefined,
      smokeExpectations,
      smokeRubric,
    );
    expect(score.reasons).not.toContain("ordered_dependencies");
    expect(score.score).toBe(2);
  });

  it("7: compiles structurally but weak fact-check instructions score 1", () => {
    const base = baseProposal({ agents: [summarizer()] });
    const weakFc = {
      ...minimalNewAgent("bpr_weak"),
      model: { bindingName: "default", modelProfileVersionId: mpv },
      instructions: "Run another pass on the text.",
    };
    const refined: BuilderProposalV1 = {
      ...base,
      agents: [summarizer(), weakFc],
      workflow: {
        nodes: [
          { key: "a", type: "AGENT", agentRef: "bpr_sum" },
          { key: "b", type: "AGENT", agentRef: "bpr_weak" },
        ],
        edges: [{ from: "a", to: "b" }],
      },
    };
    const score = scoreLiveRefinement(
      base,
      refined,
      undefined,
      smokeExpectations,
      smokeRubric,
    );
    expect(score.score).toBe(1);
    expect(score.reasons).toContain("fact_check_semantics");
  });
});

describe("M20.7.2 acceptance aggregation", () => {
  it("8–9: required scenario FAIL yields overall FAIL and nonzero exit", () => {
    const results = [{ status: "PASS" as const }, { status: "FAIL" as const }];
    const overall = deriveM20_7OverallStatus(results, {
      liveProviderCalls: true,
      allScenariosExecuted: true,
    });
    expect(overall).toBe("FAIL");
    expect(
      liveAcceptanceShouldExitNonZero(overall, {
        liveExecuteAttempted: true,
        allScenariosExecuted: true,
      }),
    ).toBe(true);
  });

  it("10: all PASS yields PASS and exit zero", () => {
    const overall = deriveM20_7OverallStatus(
      [{ status: "PASS" }, { status: "PASS" }],
      { liveProviderCalls: true, allScenariosExecuted: true },
    );
    expect(overall).toBe("PASS");
    expect(
      liveAcceptanceShouldExitNonZero(overall, {
        liveExecuteAttempted: true,
        allScenariosExecuted: true,
      }),
    ).toBe(false);
  });

  it("11: provider ERROR scenario yields ERROR exit", () => {
    const overall = deriveM20_7OverallStatus(
      [{ status: "PASS" }, { status: "ERROR" }],
      { liveProviderCalls: true, allScenariosExecuted: true },
    );
    expect(overall).toBe("ERROR");
    expect(
      liveAcceptanceShouldExitNonZero(overall, {
        liveExecuteAttempted: true,
        allScenariosExecuted: true,
      }),
    ).toBe(true);
  });

  it("12: incomplete run stays NOT_RUN without forced fail exit", () => {
    const overall = deriveM20_7OverallStatus([{ status: "PASS" }], {
      liveProviderCalls: true,
      allScenariosExecuted: false,
    });
    expect(overall).toBe("NOT_RUN");
    expect(
      liveAcceptanceShouldExitNonZero(overall, {
        liveExecuteAttempted: false,
        allScenariosExecuted: false,
      }),
    ).toBe(false);
  });

  it("refinementScore 0 maps to scenario FAIL", () => {
    expect(deriveScenarioStatus(2, 2, 0)).toBe("FAIL");
  });
});
