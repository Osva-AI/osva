import { describe, expect, it } from "vitest";

import { compareBuilderProposalChanges } from "../src/builder/compare-builder-proposal-changes.js";
import type { BuilderProposalV1 } from "../src/builder/builder-proposal.js";
import {
  baseProposal,
  minimalNewAgent,
} from "./builder-natural-language-test-helpers.js";

describe("compareBuilderProposalChanges", () => {
  it("detects registry and edge changes deterministically", () => {
    const before = baseProposal();
    const after: BuilderProposalV1 = {
      ...before,
      workflowRegistry: { ...before.workflowRegistry, name: "Renamed" },
      workflow: {
        ...before.workflow,
        edges: [{ from: "n1", to: "n1" }],
      },
    };
    const c = compareBuilderProposalChanges(before, after);
    expect(c.registryChanges.map((x) => x.field)).toContain("name");
    expect(c.graphEdgeChanges.length).toBeGreaterThan(0);
  });

  it("detects agent removal", () => {
    const withTwo = baseProposal({
      agents: [minimalNewAgent("bpr_a"), minimalNewAgent("bpr_b")],
    });
    const after = baseProposal();
    const c = compareBuilderProposalChanges(withTwo, after);
    expect(c.removedAgents.map((a) => a.ref)).toEqual(["bpr_b"]);
  });
});
