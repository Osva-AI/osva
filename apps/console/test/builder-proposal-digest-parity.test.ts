import type { ModelProfileVersionId } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { computeBuilderProposalDigest } from "@osva/domain/builder";
import type { BuilderProposalV1 } from "@osva/domain/builder";
import { parseBuilderProposalV1 } from "@osva/domain/builder/parse";

import { digestBuilderDraftProposal } from "../src/client/lib/builder-proposal-digest-client.js";
import {
  baseProposal,
  minimalNewAgent,
} from "../../../packages/domain/test/builder-natural-language-test-helpers.js";

const ALT_MPV = "mpv-alt-parity" as ModelProfileVersionId;

describe("builder proposal digest parity (domain vs browser client)", () => {
  it("identical valid proposal yields identical digest", async () => {
    const proposal = baseProposal();
    const server = computeBuilderProposalDigest(proposal);
    const browser = await digestBuilderDraftProposal(proposal);
    expect(browser).toBe(server);
  });

  it("JSON property ordering does not affect digest", async () => {
    const proposal = baseProposal();
    const reordered = JSON.parse(
      JSON.stringify({
        workflow: proposal.workflow,
        agents: proposal.agents,
        schemaVersion: proposal.schemaVersion,
        workflowRegistry: proposal.workflowRegistry,
        assumptions: proposal.assumptions,
        unresolvedRequirements: proposal.unresolvedRequirements,
      }),
    );
    const server = computeBuilderProposalDigest(proposal);
    const browser = await digestBuilderDraftProposal(reordered);
    expect(browser).toBe(server);
  });

  it("changing instructions changes digest", async () => {
    const before = baseProposal();
    const after: BuilderProposalV1 = {
      ...before,
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          instructions: "Different instructions.",
        },
      ],
    };
    expect(computeBuilderProposalDigest(before)).not.toBe(
      computeBuilderProposalDigest(after),
    );
    expect(await digestBuilderDraftProposal(before)).not.toBe(
      await digestBuilderDraftProposal(after),
    );
  });

  it("changing graph edges changes digest", async () => {
    const before = baseProposal();
    const after: BuilderProposalV1 = {
      ...before,
      workflow: {
        ...before.workflow,
        edges: [{ from: "n1", to: "n1" }],
      },
    };
    expect(computeBuilderProposalDigest(before)).not.toBe(
      computeBuilderProposalDigest(after),
    );
  });

  it("changing model bindings changes digest", async () => {
    const before = baseProposal();
    const after: BuilderProposalV1 = {
      ...before,
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          model: {
            bindingName: "default",
            modelProfileVersionId: ALT_MPV,
          },
        },
      ],
    };
    expect(computeBuilderProposalDigest(before)).not.toBe(
      computeBuilderProposalDigest(after),
    );
  });

  it("invalid proposal cannot produce a client digest", async () => {
    expect(await digestBuilderDraftProposal({ not: "a proposal" })).toBe(
      undefined,
    );
    expect(parseBuilderProposalV1({ not: "a proposal" }).ok).toBe(false);
  });
});
