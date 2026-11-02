import { describe, expect, it } from "vitest";

import {
  mapQueryToRegistryState,
  selectHomePresentation,
  type HomeRegistryEvidence,
} from "../src/client/lib/home-presentation-state";

function emptyEvidence(
  overrides: Partial<HomeRegistryEvidence> = {},
): HomeRegistryEvidence {
  return {
    agents: "success",
    agentCount: 0,
    workflows: "success",
    workflowCount: 0,
    agentRuns: "success",
    agentRunCount: 0,
    workflowRuns: "success",
    workflowRunCount: 0,
    ...overrides,
  };
}

const baseInput = {
  workspaceAligned: true,
  preference: "standard" as const,
  authContextSettled: true,
  authContextError: false,
};

describe("selectHomePresentation", () => {
  it("classifies an empty workspace as new", () => {
    const result = selectHomePresentation({
      ...baseInput,
      evidence: emptyEvidence(),
    });
    expect(result.state).toBe("new");
  });

  it("classifies agent present as active", () => {
    const result = selectHomePresentation({
      ...baseInput,
      evidence: emptyEvidence({ agentCount: 1 }),
    });
    expect(result.state).toBe("active");
  });

  it("classifies workflow present as active", () => {
    const result = selectHomePresentation({
      ...baseInput,
      evidence: emptyEvidence({ workflowCount: 1 }),
    });
    expect(result.state).toBe("active");
  });

  it("classifies recent agent run present as active", () => {
    const result = selectHomePresentation({
      ...baseInput,
      evidence: emptyEvidence({ agentRunCount: 1 }),
    });
    expect(result.state).toBe("active");
  });

  it("classifies recent workflow run present as active", () => {
    const result = selectHomePresentation({
      ...baseInput,
      evidence: emptyEvidence({ workflowRunCount: 1 }),
    });
    expect(result.state).toBe("active");
  });

  it("honors advanced preference override", () => {
    const result = selectHomePresentation({
      ...baseInput,
      preference: "advanced",
      evidence: emptyEvidence({ agentCount: 2 }),
    });
    expect(result.state).toBe("advanced");
  });

  it("returns loading when registry queries are unsettled", () => {
    const result = selectHomePresentation({
      ...baseInput,
      evidence: emptyEvidence({ agents: "unsettled" }),
    });
    expect(result.state).toBe("loading");
  });

  it("returns degraded on partial query error for empty classification", () => {
    const result = selectHomePresentation({
      ...baseInput,
      evidence: emptyEvidence({ agentRuns: "error", agentRunCount: undefined }),
    });
    expect(result.state).toBe("degraded");
  });

  it("returns loading when workspace is not aligned", () => {
    const result = selectHomePresentation({
      ...baseInput,
      workspaceAligned: false,
      evidence: emptyEvidence(),
    });
    expect(result.state).toBe("loading");
  });

  it("returns degraded when auth context fails on an empty workspace", () => {
    const result = selectHomePresentation({
      ...baseInput,
      authContextError: true,
      evidence: emptyEvidence(),
    });
    expect(result.state).toBe("degraded");
  });

  it("stays active when auth context fails but activity exists", () => {
    const result = selectHomePresentation({
      ...baseInput,
      authContextError: true,
      evidence: emptyEvidence({ agentCount: 1 }),
    });
    expect(result.state).toBe("active");
  });

  it("returns loading when auth context is unsettled", () => {
    const result = selectHomePresentation({
      ...baseInput,
      authContextSettled: false,
      evidence: emptyEvidence(),
    });
    expect(result.state).toBe("loading");
  });
});

describe("mapQueryToRegistryState", () => {
  it("returns unsettled when workspace is switching", () => {
    expect(
      mapQueryToRegistryState({
        isLoading: false,
        isError: false,
        isFetched: true,
        workspaceAligned: false,
      }),
    ).toBe("unsettled");
  });

  it("returns success after fetch for aligned workspace", () => {
    expect(
      mapQueryToRegistryState({
        isLoading: false,
        isError: false,
        isFetched: true,
        workspaceAligned: true,
      }),
    ).toBe("success");
  });
});
